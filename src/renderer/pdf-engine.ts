import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFLinkService, PDFViewer, ScrollMode } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import type { Chapter, Settings } from './model'
import { searchExcerpt } from './search-text'
import { bindReadingGestures } from './reading-gestures'
import type { ReaderEngine, ReaderEvents } from './reader-engine'

GlobalWorkerOptions.workerSrc = new URL(workerUrl, location.href).href

type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>

async function readOutline(pdf: PDFDocumentProxy, outline: Outline): Promise<Chapter[]> {
  const chapters = await Promise.all(outline.map(async item => {
    const children = await readOutline(pdf, item.items)
    try {
      const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
      const ref = destination?.[0]
      const index = typeof ref === 'number' ? ref : ref && await pdf.getPageIndex(ref)
      if (typeof index === 'number' && index >= 0 && index < pdf.numPages) {
        return [{ label: item.title, target: index + 1, children }]
      }
    } catch (error) {
      console.debug('已跳过无效的 PDF 目录目标', error)
    }
    return children
  }))
  return chapters.flat()
}

export function pdfEngine(host: HTMLElement, events: ReaderEvents, initial: Settings): ReaderEngine {
  const container = document.createElement('div')
  container.className = 'pdf-container'
  const pages = document.createElement('div')
  pages.className = 'pdfViewer'
  container.append(pages)
  host.append(container)
  const eventBus = new EventBus()
  const linkService = new PDFLinkService({ eventBus })
  linkService.externalLinkEnabled = false
  const viewer = new PDFViewer({ container, viewer: pages, eventBus, linkService })
  linkService.setViewer(viewer)
  const lifetime = new AbortController()
  let task: ReturnType<typeof getDocument> | undefined
  let documentProxy: PDFDocumentProxy | undefined
  let settings = initial
  let chapters: Chapter[] = []
  let ready = false

  function report() {
    if (!ready || !documentProxy || lifetime.signal.aborted) return
    const page = viewer.currentPageNumber
    const chapter = chapters.findLast(item => typeof item.target === 'number' && item.target <= page)
    events.position({ target: page, page, total: documentProxy.numPages, chapter: chapter?.label ?? `第 ${page} 页` })
  }

  function configure(next: Settings) {
    settings = next
    if (!ready) return
    const mode = next.mode === 'page' ? ScrollMode.PAGE : ScrollMode.VERTICAL
    if (viewer.scrollMode !== mode) {
      viewer.scrollMode = mode
      viewer.currentScaleValue = next.mode === 'page' ? 'page-fit' : 'page-width'
    }
  }

  const resize = new ResizeObserver(() => {
    if (ready) viewer.currentScaleValue = settings.mode === 'page' ? 'page-fit' : 'page-width'
  })
  resize.observe(container)
  eventBus.on('pagechanging', report, { signal: lifetime.signal })
  bindReadingGestures(container, events, lifetime.signal)

  async function loadOutline(pdf: PDFDocumentProxy) {
    const toc = await readOutline(pdf, await pdf.getOutline() ?? [])
    if (lifetime.signal.aborted || !toc.length) return
    const flatten = (items: Chapter[]): Chapter[] => items.flatMap(item => [item, ...flatten(item.children ?? [])])
    chapters = flatten(toc).sort((a, b) => Number(a.target) - Number(b.target))
    events.chapters(toc)
    report()
  }

  async function loadCover(pdf: PDFDocumentProxy) {
    const page = await pdf.getPage(1)
    if (lifetime.signal.aborted) return
    const viewport = page.getViewport({ scale: 160 / page.getViewport({ scale: 1 }).width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = Math.min(viewport.height, 400)
    await page.render({ canvas, viewport }).promise
    if (!lifetime.signal.aborted) events.cover?.(canvas.toDataURL('image/jpeg', 0.75))
  }

  return {
    async open(file, start) {
      const data = await file.arrayBuffer()
      if (lifetime.signal.aborted) return
      const asset = (name: string) => new URL(`./pdf/${name}/`, location.href).href
      task = getDocument({
        data, cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'),
        wasmUrl: asset('wasm'), iccUrl: asset('iccs'), isEvalSupported: false
      })
      const pdf = await task.promise
      if (lifetime.signal.aborted) return
      documentProxy = pdf
      events.chapters(Array.from({ length: pdf.numPages }, (_, index) => ({
        label: `第 ${index + 1} 页`, target: index + 1
      })))
      eventBus.on('pagesinit', () => {
        ready = true
        configure(settings)
        viewer.currentScaleValue = settings.mode === 'page' ? 'page-fit' : 'page-width'
        if (typeof start?.target === 'number') viewer.currentPageNumber = Math.min(pdf.numPages, Math.max(1, start.target))
        report()
      }, { signal: lifetime.signal, once: true })
      linkService.setDocument(pdf)
      viewer.setDocument(pdf)
      void loadOutline(pdf).catch(error => console.debug('无法读取 PDF 目录', error))
      if (events.cover) void loadCover(pdf).catch(error => console.debug('无法提取 PDF 封面', error))
    },
    async seek(fraction) {
      if (ready && documentProxy) viewer.currentPageNumber = 1 + Math.round(fraction * (documentProxy.numPages - 1))
    },
    async *search(query, signal) {
      const pdf = documentProxy
      if (!pdf) return
      const needle = query.toLocaleLowerCase()
      for (let target = 1; target <= pdf.numPages; target++) {
        if (signal.aborted || lifetime.signal.aborted) return
        const content = await (await pdf.getPage(target)).getTextContent()
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? ' ' : '') : '').join('')
        const haystack = text.toLocaleLowerCase()
        for (let match = haystack.indexOf(needle); match >= 0; match = haystack.indexOf(needle, match + needle.length)) {
          if (signal.aborted || lifetime.signal.aborted) return
          yield { target, excerpt: searchExcerpt(text, match, needle.length) }
        }
      }
    },
    async go(target) {
      if (ready && typeof target === 'number') viewer.currentPageNumber = target
    },
    async step(direction) {
      if (!ready) return
      if (direction < 0) viewer.previousPage()
      else viewer.nextPage()
    },
    configure,
    close() {
      lifetime.abort()
      resize.disconnect()
      viewer.setDocument(null as unknown as PDFDocumentProxy)
      container.remove()
      void task?.destroy().catch(error => console.debug('已结束 PDF 加载任务', error))
    }
  }
}
