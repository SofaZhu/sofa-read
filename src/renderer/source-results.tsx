import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SOURCE_NAMES, sourceCatalog, type Source, type SourceBook } from './source-client'

const BATCH_SIZE = 20

interface Cursor {
  source: Source
  next: string | null
  buffer: SourceBook[]
  failed: boolean
  warning?: string
  seen: Set<string>
}

interface SourceResultsProps {
  sources: Source[]
  query: string
  category: number
  render(book: SourceBook): ReactNode
}

/** 合并已解锁书源的分页，每次最多追加二十本。 */
export function SourceResults({ sources, query, category, render }: SourceResultsProps) {
  const [books, setBooks] = useState<SourceBook[]>([])
  const [busy, setBusy] = useState(true)
  const [more, setMore] = useState(true)
  const [automatic, setAutomatic] = useState(true)
  const [messages, setMessages] = useState<string[]>([])
  const sentinel = useRef<HTMLButtonElement>(null)
  const state = useRef({
    cursors: sources.map((source): Cursor => ({ source, next: '', buffer: [], failed: false, seen: new Set() })),
    added: new Set<string>(),
    lifetime: new AbortController(),
    busy: false,
    offset: 0
  })

  const load = useCallback(async (retry = false) => {
    const current = state.current
    const signal = current.lifetime.signal
    if (current.busy || signal.aborted) return
    current.busy = true
    setBusy(true)
    if (retry) for (const cursor of current.cursors) cursor.failed = false
    const batch: SourceBook[] = []
    try {
      // 各来源并行翻页。暂时取不到的来源保留游标，可单独重试。
      for (let round = 0; round < 3 && batch.length < BATCH_SIZE; round++) {
        const empty = current.cursors.filter(cursor => !cursor.failed && !cursor.buffer.length && cursor.next !== null)
        await Promise.all(empty.map(async cursor => {
          const start = cursor.next ?? ''
          try {
            const page = await sourceCatalog(cursor.source, start, signal, query, category)
            if (signal.aborted) return
            cursor.seen.add(start)
            cursor.next = page.next !== null && !cursor.seen.has(page.next) ? page.next : null
            cursor.buffer = page.books
            cursor.warning = page.warning
            if (page.warning) {
              cursor.failed = true
              cursor.next = start
            }
          } catch (error) {
            if (signal.aborted) return
            console.warn('无法加载书源列表', cursor.source, error)
            cursor.failed = true
          }
        }))
        if (signal.aborted) return
        while (batch.length < BATCH_SIZE && current.cursors.some(cursor => cursor.buffer.length)) {
          const cursor = current.cursors[current.offset++ % current.cursors.length]
          const book = cursor.buffer.shift()
          if (!book || current.added.has(book.id)) continue
          current.added.add(book.id)
          batch.push(book)
        }
        if (!current.cursors.some(cursor => !cursor.failed && cursor.next !== null)) break
      }
      setBooks(previous => [...previous, ...batch])
      setAutomatic(batch.length > 0)
      setMore(current.cursors.some(cursor => cursor.buffer.length || !cursor.failed && cursor.next !== null))
      setMessages(current.cursors.flatMap(cursor => cursor.failed ? [cursor.warning ?? SOURCE_NAMES[cursor.source] + '暂时无法加载。'] : []))
    } finally {
      current.busy = false
      if (!signal.aborted) setBusy(false)
    }
  }, [category, query])

  useEffect(() => {
    const current = state.current
    void load()
    return () => current.lifetime.abort()
  }, [load])

  useEffect(() => {
    if (busy || !more || !automatic || !sentinel.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        void load()
      }
    }, { rootMargin: '0px 0px 120px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [busy, more, automatic, load])

  return <>
    <div className="source-results">{books.map(render)}</div>
    {busy && <p role="status">正在加载书目…</p>}
    {!busy && messages.length > 0 && <div className="source-actions">
      <p role="status">{messages.join(' ')}</p>
      <button onClick={() => void load(true)}>重试失败的书源</button>
    </div>}
    {!busy && !more && !books.length && messages.length === 0 && <p>{query ? '没有找到匹配书籍。' : '没有可用书目。'}</p>}
    {!busy && more && <button ref={sentinel} onClick={() => void load()}>加载更多</button>}
  </>
}
