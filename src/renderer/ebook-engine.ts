import { View, makeBook } from '@ray-d-song/foliate-js/view.js'
import lato from '@fontsource/lato/files/lato-latin-400-normal.woff2?url'
import shuhei from '@fontpkg/alimama-shu-hei-ti/AlimamaShuHeiTi-Bold.woff2?url'
import puhuiti from 'alibabapuhuiti-3-65-medium/AlibabaPuHuiTi-3-65-Medium.woff2?url'
import { THEMES, type Chapter, type Settings } from './model'
import type { ReaderEngine, ReaderEvents } from './reader-engine'
import { decodeText, makeTextBook } from './text-book'

interface Relocation {
  cfi: string
  section?: { current: number; total: number }
  location?: { current: number; total: number }
  tocItem?: { label?: string }
}

export function ebookEngine(host: HTMLElement, events: ReaderEvents, initial: Settings): ReaderEngine {
  const view = new View()
  const lifetime = new AbortController()
  const { signal } = lifetime
  let settings = initial
  let book: View['book'] | undefined
  let initialized = false
  let opening = true
  let pending = Promise.resolve()

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
      html { background: ${next.background || theme.bg} !important; color-scheme: ${next.theme === 'dark' ? 'dark' : 'light'}; }
      body { background: transparent !important; }
      body, p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6 {
        color: ${theme.fg} !important; font-family: ${font}, serif !important;
        line-height: ${next.spacing} !important;
      }
      body, p, div, span, li, blockquote { font-size: ${next.size}px !important; }
      p { white-space: pre-wrap; }
    `)
  }

  view.addEventListener('external-link', event => event.preventDefault(), { signal })
  view.addEventListener('load', event => {
    const { doc } = (event as CustomEvent<{ doc: Document }>).detail
    doc.addEventListener('keydown', event => {
      events.activity?.()
      events.key(event)
    }, { signal })
    if (events.activity) {
      doc.addEventListener('pointerdown', events.activity, { signal, passive: true })
      doc.addEventListener('scroll', events.activity, { signal, passive: true })
    }
    doc.addEventListener('click', event => {
      if ((event.target as Element).closest('a, button, input, label') || doc.getSelection()?.toString()) return
      events.tap(event, doc.defaultView?.innerWidth ?? host.clientWidth)
    }, { signal })
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
      chapter: detail.tocItem?.label?.trim() || `第 ${index + 1} 节`
    })
  }, { signal })

  function dispose() {
    try {
      if (initialized) view.close()
    } finally {
      book?.destroy?.()
      view.remove()
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
        await view.init({ lastLocation: start?.target, showTextStart: true })
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
        if (!signal.aborted && events.cover && book.getCover) {
          try {
            const blob = await book.getCover()
            if (blob && !signal.aborted) {
              const bitmap = await createImageBitmap(blob, { resizeWidth: 160 })
              try {
                const canvas = document.createElement('canvas')
                canvas.width = bitmap.width
                canvas.height = Math.min(bitmap.height, 400)
                canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
                if (!signal.aborted) events.cover(canvas.toDataURL('image/jpeg', 0.75))
              } finally {
                bitmap.close()
              }
            }
          } catch (error) {
            console.debug('无法提取电子书封面', error)
          }
        }
      } finally {
        opening = false
        if (signal.aborted) dispose()
      }
    },
    go: target => navigate(() => view.goTo(target)),
    step: direction => navigate(() => direction < 0 ? view.prev() : view.next()),
    configure,
    close() {
      lifetime.abort()
      if (!opening) void pending.finally(dispose).catch(error => console.error('无法清理电子书视图', error))
    }
  }
}
