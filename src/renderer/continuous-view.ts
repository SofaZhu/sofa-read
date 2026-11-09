import type { FoliateBook, FoliateTarget } from '@ray-d-song/foliate-js/view.js'

interface SectionFrame {
  frame: HTMLIFrameElement
  ready: Promise<HTMLIFrameElement>
  controller: AbortController
  stop?: () => void
  loaded?: boolean
}

const NEIGHBORS = 3

/** 将原书章节放进同一个滚动区域，保留章内链接和定位锚点。 */
export class ContinuousView extends HTMLElement {
  private book!: FoliateBook
  private readonly entries = new Map<number, SectionFrame>()
  private readonly retiring = new Map<number, Promise<void>>()
  private readonly sizeObserver = new ResizeObserver(() => { if (this.book) this.updateEndPadding() })
  private readonly lifetime = new AbortController()
  private readonly track = document.createElement('div')
  private index = -1
  private navigating = false
  private styles = ''
  private last = ''
  private frameRequest = 0
  private prefetchVersion = 0
  private targetOffset = 0

  constructor() {
    super()
    this.className = 'continuous-view'
    Object.assign(this.style, {
      display: 'block', position: 'absolute', inset: '0',
      overflowY: 'auto', overflowX: 'hidden', overflowAnchor: 'none', overscrollBehavior: 'contain'
    })
    this.track.className = 'continuous-track'
    this.track.style.position = 'relative'
    this.append(this.track)
    this.sizeObserver.observe(this)
    this.addEventListener('scroll', () => {
      if (!this.frameRequest) this.frameRequest = requestAnimationFrame(() => {
        this.frameRequest = 0
        if (!this.navigating) this.report()
      })
    }, { signal: this.lifetime.signal, passive: true })
  }

  open(book: FoliateBook) {
    this.book = book
  }

  private removeSection(index: number) {
    const entry = this.entries.get(index)
    if (!entry) return
    const above = entry.frame.offsetTop + entry.frame.offsetHeight <= this.scrollTop
    const top = this.scrollTop
    const height = entry.frame.offsetHeight
    this.entries.delete(index)
    entry.controller.abort()
    const retired = entry.ready.then(() => {}, () => {})
    this.retiring.set(index, retired)
    void retired.then(() => { if (this.retiring.get(index) === retired) this.retiring.delete(index) })
    entry.stop?.()
    entry.frame.remove()
    if (entry.loaded) this.book.sections[index].unload?.()
    this.updateEndPadding()
    if (above) this.scrollTop = top - height
  }

  private load(index: number): Promise<HTMLIFrameElement> {
    const existing = this.entries.get(index)
    if (existing) return existing.ready
    const retired = this.retiring.get(index)
    const section = this.book.sections[index]
    const frame = document.createElement('iframe')
    Object.assign(frame.style, { display: 'block', width: '100%', height: '1px', border: '0' })
    frame.title = `第 ${index + 1} 节`
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts')
    frame.setAttribute('scrolling', 'no')
    const controller = new AbortController()
    const { signal } = controller
    const entry: SectionFrame = { frame, controller, ready: Promise.resolve(frame) }
    this.entries.set(index, entry)

    entry.ready = (async () => {
      if (retired) await retired
      if (signal.aborted) throw signal.reason
      const url = await section.load()
      if (signal.aborted) {
        section.unload?.()
        throw signal.reason
      }
      entry.loaded = true
      return new Promise<HTMLIFrameElement>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        frame.addEventListener('load', () => {
          const doc = frame.contentDocument
          if (!doc?.body) {
            reject(new Error('章节正文不可用。'))
            return
          }
          const style = doc.createElement('style')
          style.dataset.sofaContinuous = ''
          doc.head.append(style)
          this.styleFrame(doc)
          this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))

          const measure = () => {
            const body = doc.body
            const top = this.scrollTop
            const height = frame.offsetHeight
            const above = frame.offsetTop <= top && index < this.index
            const next = Math.max(1, Math.ceil(Math.max(body.getBoundingClientRect().bottom, body.scrollHeight)))
            if (next !== height) {
              frame.style.height = `${next}px`
              this.updateEndPadding()
              if (above) this.scrollTop = top + next - height
            }
          }
          const observer = new ResizeObserver(measure)
          observer.observe(doc.body)
          entry.stop = () => observer.disconnect()
          measure()
          resolve(frame)
        }, { signal, once: true })
        frame.src = url
        const next = [...this.entries].filter(([other, item]) => other > index && item.frame.parentNode)
          .sort(([a], [b]) => a - b)[0]
        const top = this.scrollTop
        this.track.insertBefore(frame, next?.[1].frame ?? null)
        if (index < this.index && frame.offsetTop <= top) this.scrollTop = top + frame.offsetHeight
      })
    })()
    return entry.ready
  }

  private styleFrame(doc: Document) {
    const style = doc.querySelector<HTMLStyleElement>('style[data-sofa-continuous]')
    if (style) style.textContent = `${this.styles}
      html, body { overflow: hidden !important; height: auto !important; min-height: 0 !important; }
      body { display: flow-root; box-sizing: border-box; margin: 0 auto !important; padding: 12px clamp(14px, 4vw, 36px); max-width: 850px; overflow-wrap: anywhere; }
      img, svg, video { max-width: 100%; }
    `
  }

  setStyles(styles: string) {
    if (styles === this.styles) return
    this.styles = styles
    for (const { frame } of this.entries.values()) if (frame.contentDocument) this.styleFrame(frame.contentDocument)
  }

  private updateEndPadding() {
    const frames = [...this.entries.values()].map(entry => entry.frame).filter(frame => frame.parentNode)
    const last = this.entries.get(this.book.sections.length - 1)?.frame
    const active = this.entries.get(this.index)?.frame
    const bottom = Math.max(0, ...frames.map(frame => frame.offsetTop + frame.offsetHeight))
    const anchor = Math.max(last?.offsetTop ?? 0, active ? active.offsetTop + this.targetOffset : 0)
    this.track.style.paddingBottom = `${Math.max(0, anchor + this.clientHeight - bottom)}px`
  }

  private prefetch(index: number) {
    const version = ++this.prefetchVersion
    const current = () => version === this.prefetchVersion && !this.lifetime.signal.aborted
    const nearby = new Set([index])

    const loadSide = async (direction: number) => {
      let count = 0
      for (let other = index + direction; current() && other >= 0 && other < this.book.sections.length; other += direction) {
        if (this.book.sections[other].linear === 'no') continue
        nearby.add(other)
        try {
          const frame = await this.load(other)
          count++
          // 极短章节可能在同一屏中出现多个，先确保有足够正文供下一次滚动。
          const buffered = direction < 0 ? this.scrollTop - frame.offsetTop
            : frame.offsetTop + frame.offsetHeight - this.scrollTop
          if (count >= NEIGHBORS && buffered >= this.clientHeight * 2) break
        } catch (error) {
          if (!current()) return
          this.removeSection(other)
          console.debug('无法预载相邻章节', error)
          break
        }
      }
    }

    void Promise.all([loadSide(-1), loadSide(1)]).then(() => {
      if (!current()) return
      for (const other of this.entries.keys()) if (!nearby.has(other)) this.removeSection(other)
    })
  }

  private report() {
    const top = this.scrollTop + 4
    const hit = [...this.entries].sort(([a], [b]) => a - b).find(([, { frame }]) =>
      frame.offsetHeight > 1 && frame.offsetTop + frame.offsetHeight > top)
    if (!hit) return
    const [index, { frame }] = hit
    if (this.index !== index) {
      this.index = index
      this.targetOffset = 0
      this.updateEndPadding()
      this.prefetch(index)
    }
    const local = Math.max(0, this.scrollTop - frame.offsetTop)
    const signature = `${index}:${local}`
    if (signature === this.last) return
    this.last = signature
    const doc = frame.contentDocument
    // 在视口起始的正文中取锚点，让续读和翻页模式共用原书 CFI。
    const body = doc?.body?.getBoundingClientRect()
    const y = Math.min(local + 14, frame.clientHeight - 1)
    const range = body && local > 0
      ? doc?.caretRangeFromPoint(Math.min(body.right - 16, body.left + 24), y) ?? undefined : undefined
    this.dispatchEvent(new CustomEvent('relocate', { detail: {
      reason: 'scroll', index, range, fraction: local / frame.offsetHeight,
      size: Math.min(frame.offsetHeight - local, this.clientHeight) / frame.offsetHeight
    } }))
  }

  async goTo({ index, anchor }: FoliateTarget) {
    if (!this.book.sections[index]) return
    this.navigating = true
    this.prefetchVersion++
    try {
      if (!this.entries.has(index)) for (const other of this.entries.keys()) this.removeSection(other)
      const frame = await this.load(index)
      if (this.lifetime.signal.aborted) return
      const doc = frame.contentDocument!
      const position = typeof anchor === 'function' ? anchor(doc) : anchor
      const offset = typeof position === 'number' ? position * Math.max(0, frame.offsetHeight - 1)
        : position?.getBoundingClientRect().top ?? 0
      this.index = index
      this.targetOffset = Math.max(0, offset)
      this.prefetch(index)
      this.updateEndPadding()
      this.scrollTop = frame.offsetTop + offset
      this.last = ''
      // 目录跳到靠近书尾的短章时，仍报告选中的目标章。
      if (this.scrollTop + 4 < frame.offsetTop) {
        this.dispatchEvent(new CustomEvent('relocate', { detail: { reason: 'scroll', index, fraction: 0, size: 0 } }))
      } else this.report()
    } finally {
      this.navigating = false
    }
  }

  getVisibleDocuments() {
    const viewport = this.getBoundingClientRect()
    return [...this.entries].flatMap(([index, { frame }]) => {
      const bounds = frame.getBoundingClientRect()
      const doc = frame.contentDocument
      return doc?.body && bounds.bottom > viewport.top && bounds.top < viewport.bottom
        ? [{ index, doc }] : []
    })
  }

  getContents() {
    return []
  }

  destroy() {
    this.lifetime.abort()
    this.sizeObserver.disconnect()
    cancelAnimationFrame(this.frameRequest)
    for (const index of this.entries.keys()) this.removeSection(index)
  }
}

customElements.define('sofa-continuous', ContinuousView)
