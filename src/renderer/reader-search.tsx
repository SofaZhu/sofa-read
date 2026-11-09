import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ReaderEngine, SearchMatch } from './reader-engine'
import { limitSearchQuery, SEARCH_QUERY_LIMIT } from './search-text'

const BATCH_SIZE = 20

/** 显示书内全文匹配，离开搜索时停止当前检索。 */
export function ReaderSearch({ engine, jump }: { engine: ReaderEngine | null; jump(target: SearchMatch['target']): void }) {
  const task = useRef<AbortController>(null)
  const tail = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [visible, setVisible] = useState(BATCH_SIZE)
  const [status, setStatus] = useState('')
  useEffect(() => () => task.current?.abort(), [])

  useEffect(() => {
    const sentinel = tail.current
    if (!sentinel || visible >= results.length) return
    const search = task.current
    let active = true
    const observer = new IntersectionObserver(entries => {
      if (!active || search !== task.current || !entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      setVisible(count => count + BATCH_SIZE)
    }, { root: sentinel.closest('.reader-sheet'), rootMargin: '0px 0px 72px' })
    observer.observe(sentinel)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [visible, results.length])

  async function search(event: FormEvent) {
    event.preventDefault()
    const term = limitSearchQuery(query).trim()
    if (composing.current || !term || !engine) return
    task.current?.abort()
    const controller = new AbortController()
    task.current = controller
    let batch: SearchMatch[] = []
    let count = 0
    setResults([])
    setVisible(BATCH_SIZE)
    setStatus('正在搜索…')

    function appendBatch() {
      if (!batch.length) return
      const completed = batch
      batch = []
      setResults(previous => [...previous, ...completed])
    }

    try {
      for await (const result of engine.search(term, controller.signal)) {
        if (controller.signal.aborted) return
        batch.push(result)
        count++
        if (batch.length === BATCH_SIZE) {
          appendBatch()
          setStatus(`已找到 ${count} 条，正在搜索…`)
          // 给界面留出渲染与取消的机会，检索继续扫描全文。
          await new Promise<void>(resolve => setTimeout(resolve, 0))
          if (controller.signal.aborted) return
        }
      }
      if (!controller.signal.aborted) {
        appendBatch()
        setStatus(count ? `找到 ${count} 条匹配` : '没有找到匹配内容')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        appendBatch()
        console.warn('全文搜索失败', error)
        setStatus('搜索失败，请重试。')
      }
    }
  }

  return <>
    <form className="reader-search" onSubmit={event => void search(event)}>
      <input autoFocus aria-label="搜索关键词" type="search" value={query}
        placeholder={`最多 ${SEARCH_QUERY_LIMIT} 个字符`}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={event => { composing.current = false; setQuery(limitSearchQuery(event.currentTarget.value)) }}
        onChange={event => setQuery(composing.current ? event.target.value : limitSearchQuery(event.target.value))} />
      <button className="primary" disabled={!query.trim()}>搜索</button>
    </form>
    {status && <p className="search-status" role="status">{status}</p>}
    <ul className="search-results">{results.slice(0, visible).map(({ target, excerpt }, index) =>
      <li key={index}><button onClick={() => jump(target)}>{excerpt}</button></li>)}</ul>
    {visible < results.length && <div className="search-tail" ref={tail} aria-hidden="true" />}
  </>
}
