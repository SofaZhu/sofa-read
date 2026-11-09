import { View, makeBook } from '@ray-d-song/foliate-js/view.js'
import lato from '@fontsource/lato/files/lato-latin-400-normal.woff2?url'
import shuhei from '@fontpkg/alimama-shu-hei-ti/AlimamaShuHeiTi-Bold.woff2?url'
import puhuiti from 'alibabapuhuiti-3-65-medium/AlibabaPuHuiTi-3-65-Medium.woff2?url'
import { THEMES, type Chapter, type Settings } from './model'
import type { ReaderEngine, ReaderEvents } from './reader-engine'
import { bindReadingGestures } from './reading-gestures'
import { ContinuousView } from './continuous-view'
import { decodeText, makeTextBook } from './text-book'

interface Relocation {
  cfi: string
  fraction?: number
  section?: { current: number; total: number }
  location?: { current: number; total: number }
  tocItem?: { label?: string }
}

export function ebookEngine(host: HTMLElement, events: ReaderEvents, initial: Settings): ReaderEngine {
  const view = new View()
  if (initial.mode === 'scroll') view.sofaCreateRenderer = () => new ContinuousView()
  const lifetime = new AbortController()
  const { signal } = lifetime
  let settings = initial
  let book: View['book'] | undefined
  let initialized = false
  let opening = true
  let pending = Promise.resolve()
  let cover: Promise<void> | undefined

  function configure(next: Settings) {
    settings = next
    const theme = THEMES[next.theme]
    const renderer = view.renderer
    if (!renderer) return
    const flow = next.mode === 'scroll' ? 'scrolled' : 'paginated'
    if (renderer.getAttribute('flow') !== flow) renderer.setAttribute('flow', flow)
    renderer.setAttribute('max-column-count', '1')
    const font = ['serif', 'sans-serif', 'monospace'].includes(next.font) ? next.font : JSON.stringify(next.font)
    renderer.setStyles?.(`
      @font-face { font-family: Lato; src: url(${JSON.stringify(new URL(lato, location.href).href)}); }
      @font-face { font-family: "阿里巴巴普惠体"; src: url(${JSON.stringify(new URL(puhuiti, location.href).href)}); }
      @font-face { font-family: "阿里妈妈数黑体"; src: url(${JSON.stringify(new URL(shuhei, location.href).href)}); }
      html { touch-action: manipulation; background: ${next.background || theme.bg} !important; color-scheme: ${next.theme === 'dark' ? 'dark' : 'light'}; }
      body { background: transparent !important; }
      body, p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6 {
        color: ${theme.fg} !important; font-family: ${font}, serif !important;
        line-height: ${next.spacing} !important;
      }
      body, p, div, span, li, blockquote { font-size: ${next.size}px !important; }
      p { white-space: pre-wrap; }
    `)
  }

  bindReadingGestures(host, events, signal)
  view.addEventListener('external-link', event => event.preventDefault(), { signal })
  view.addEventListener('load', event => {
    const { doc } = (event as CustomEvent<{ doc: Document }>).detail
    doc.addEventListener('keydown', event => {
      events.activity?.()
      events.key(event)
    }, { signal })
    bindReadingGestures(doc, events, signal, host)
  }, { signal })
  view.addEventListener('relocate', event => {
    const detail = (event as CustomEvent<Relocation>).detail
    const index = detail.section?.current ?? 0
    const location = detail.location
    const estimated = !view.isFixedLayout
    const total = Math.max(1, (estimated ? location?.total : detail.section?.total) || book?.sections.length || 1)
    const page = Math.min(total, (estimated ? location?.current ?? index : index) + 1)
    events.position({
      target: detail.cfi, page, total, estimated,
      fraction: typeof detail.fraction === 'number' && Number.isFinite(detail.fraction)
        ? Math.max(0, Math.min(1, detail.fraction)) : undefined,
      chapter: detail.tocItem?.label?.trim() || `第 ${index + 1} 节`
    })
  }, { signal })

  function dispose() {
    try {
      if (initialized || view.renderer instanceof ContinuousView) view.close()
    } finally {
      view.remove()
      if (cover) void cover.finally(() => book?.destroy?.()).catch(error => console.debug('无法清理书籍资源', error))
      else book?.destroy?.()
    }
  }

  function navigate(action: () => Promise<void>) {
    // 引擎翻页包含异步排版，串行执行可以避免快速连按时重入。
    const operation = pending.then(async () => {
      if (!signal.aborted && initialized) await action()
    })
    pending = operation.catch(() => {})
    return operation
  }

  async function loadCover(source: View['book']) {
    try {
      const blob = await source.getCover?.()
      if (!blob || signal.aborted) return
      const bitmap = await createImageBitmap(blob, { resizeWidth: 160 })
      try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = Math.min(bitmap.height, 400)
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
        if (!signal.aborted) events.cover?.(canvas.toDataURL('image/jpeg', 0.75))
      } finally {
        bitmap.close()
      }
    } catch (error) {
      console.debug('无法提取电子书封面', error)
    }
  }

  return {
    async open(file, start) {
      try {
        const format = file.name.toLowerCase()
        const source: View['book'] = format.endsWith('.txt')
          ? makeTextBook(decodeText(await file.arrayBuffer()))
          : await makeBook(new File([file], format, { type: file.type }))
        book = source
        if (signal.aborted) return
        if (!book.sections.length) throw new Error('这本书没有可阅读的内容。')
        host.append(view)
        await view.open(book)
        if (signal.aborted) return
        configure(settings)
        try {
          await view.init({ lastLocation: start?.target, showTextStart: true })
        } catch (error) {
          if (signal.aborted || start?.target === undefined) throw error
          // 文件重新定位或版本更新后，旧 CFI 的正文锚点可能已经失效。
          const index = view.resolveNavigation(start.target)?.index
          const fallback = typeof index === 'number' && index >= 0 && index < book.sections.length ? index : undefined
          await view.init({ lastLocation: fallback, showTextStart: true })
        }
        initialized = true

        function toChapters(items: NonNullable<View['book']['toc']>): Chapter[] {
          return items.map((item, index) => ({
            label: item.label?.trim() || `第 ${index + 1} 节`,
            target: item.href,
            children: item.subitems ? toChapters(item.subitems) : undefined
          }))
        }

        if (!signal.aborted) {
          events.chapters(book.toc?.length ? toChapters(book.toc) : book.sections.flatMap((section, index) =>
            section.linear === 'no' ? [] : [{ label: `第 ${index + 1} 节`, target: index }]))
        }
        if (!signal.aborted && events.cover && book.getCover) cover = loadCover(book)
      } finally {
        opening = false
        if (signal.aborted) dispose()
      }
    },
    go: target => navigate(() => view.goTo(target)),
    seek: fraction => navigate(async () => {
      if (view.resolveNavigation({ fraction })) await view.goToFraction(fraction)
      else if (book) await view.goTo(Math.round(fraction * (book.sections.length - 1)))
    }),
    async *search(query, searchSignal) {
      if (!book) return
      const needle = query.toLocaleLowerCase()
      for (const [index, section] of book.sections.entries()) {
        if (signal.aborted || searchSignal.aborted) return
        const doc = await section.createDocument?.()
        if (!doc?.body) continue
        const nodes: { node: Text; start: number }[] = []
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        let text = ''
        for (let next = walker.nextNode(); next; next = walker.nextNode()) {
          if (next.parentElement?.closest('script, style')) continue
          nodes.push({ node: next as Text, start: text.length })
          text += next.nodeValue ?? ''
        }
        const haystack = text.toLocaleLowerCase()
        let nodeIndex = 0
        for (let match = haystack.indexOf(needle); match >= 0; match = haystack.indexOf(needle, match + needle.length)) {
          if (searchSignal.aborted || signal.aborted) return
          while (nodeIndex + 1 < nodes.length && nodes[nodeIndex + 1].start <= match) nodeIndex++
          const { node, start } = nodes[nodeIndex]
          const range = doc.createRange()
          range.setStart(node, Math.min(node.length, match - start))
          range.collapse(true)
          yield { target: view.getCFI(index, range), excerpt: text.slice(Math.max(0, match - 40), match + needle.length + 55).trim() }
        }
      }
    },
    step: direction => navigate(() => direction < 0 ? view.prev() : view.next()),
    configure,
    close() {
      lifetime.abort()
      if (!opening) void pending.finally(dispose).catch(error => console.error('无法清理电子书视图', error))
    }
  }
}
