import type { ReaderEvents } from './reader-engine'

const interactive = 'a, button, input, label, select, textarea, [contenteditable]'

export function bindReadingGestures(surface: HTMLElement | Document, events: ReaderEvents, signal: AbortSignal, viewport?: HTMLElement) {
  const isDocument = (target: Document | HTMLElement): target is Document => target.nodeType === 9
  const doc = isDocument(surface) ? surface : surface.ownerDocument
  const options = { signal, passive: true, capture: true }
  let start: { x: number; y: number; time: number; id: number } | undefined
  let scrollReported = false
  let touchOrigin: { x: number; y: number; id: number } | undefined
  const width = () => viewport?.clientWidth ?? (isDocument(surface) ? doc.documentElement.clientWidth : surface.clientWidth)
  const localX = (x: number) => {
    if (!isDocument(surface)) return x - surface.getBoundingClientRect().left
    if (!viewport) return x
    // 分页 iframe 可能横跨多页。将章内坐标换算成当前可见阅读区的坐标。
    return x + (doc.defaultView?.frameElement?.getBoundingClientRect().left ?? 0) - viewport.getBoundingClientRect().left
  }

  // 以抬起为准。拖动、长按与书内链接不触发阅读控制。
  surface.addEventListener('pointerdown', ((event: PointerEvent) => {
    start = event.isPrimary && event.button === 0 && !(event.target as Element | null)?.closest?.(interactive)
      ? { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId } : undefined
    events.activity?.()
  }) as EventListener, options)
  surface.addEventListener('pointercancel', () => { start = undefined }, options)
  surface.addEventListener('pointerup', ((event: PointerEvent) => {
    const down = start
    start = undefined
    if (!down || event.pointerId !== down.id || performance.now() - down.time > 200 ||
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > 12 ||
      (event.target as Element | null)?.closest?.(interactive) || doc.getSelection()?.toString()) return
    events.tap(localX(event.clientX) / width())
  }) as EventListener, options)

  surface.addEventListener('wheel', ((event: WheelEvent) => {
    if (!event.ctrlKey && (event.deltaY || event.deltaX)) events.scroll()
  }) as EventListener, options)
  surface.addEventListener('touchstart', ((event: TouchEvent) => {
    const touch = event.touches[0]
    scrollReported = false
    touchOrigin = event.touches.length === 1
      ? { x: touch.clientX, y: touch.clientY, id: touch.identifier } : undefined
  }) as EventListener, options)
  surface.addEventListener('touchmove', ((event: TouchEvent) => {
    const down = touchOrigin
    if (!down || scrollReported || event.touches.length !== 1) return
    const touch = event.touches[0]
    if (touch.identifier !== down.id || Math.hypot(touch.clientX - down.x, touch.clientY - down.y) <= 12) return
    scrollReported = true
    events.scroll()
  }) as EventListener, options)
  surface.addEventListener('touchcancel', () => { touchOrigin = undefined }, options)
  surface.addEventListener('touchend', ((event: TouchEvent) => {
    const down = touchOrigin
    touchOrigin = undefined
    if (!down || localX(down.x) > 24) return
    const touch = Array.from(event.changedTouches).find(item => item.identifier === down.id)
    if (!touch) return
    const distance = touch.clientX - down.x
    if (distance >= 56 && distance > Math.abs(touch.clientY - down.y) * 1.6) events.back()
  }) as EventListener, options)
}
