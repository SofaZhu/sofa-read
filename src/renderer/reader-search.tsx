import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ReaderEngine, SearchMatch } from './reader-engine'

/** 显示书内全文匹配，离开搜索时停止当前检索。 */
export function ReaderSearch({ engine, jump }: { engine: ReaderEngine | null; jump(target: SearchMatch['target']): void }) {
  const task = useRef<AbortController>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [status, setStatus] = useState('')
  useEffect(() => () => task.current?.abort(), [])

  async function search(event: FormEvent) {
    event.preventDefault()
    const term = query.trim()
    if (!term || !engine) return
    task.current?.abort()
    const controller = new AbortController()
    task.current = controller
    const matches: SearchMatch[] = []
    setResults([])
    setStatus('正在搜索…')
    try {
      for await (const result of engine.search(term, controller.signal)) {
        if (controller.signal.aborted) return
        matches.push(result)
        if (matches.length % 20 === 1) setResults([...matches])
        if (matches.length >= 100) break
      }
      if (!controller.signal.aborted) {
        setResults(matches)
        setStatus(matches.length >= 100 ? '显示前 100 条匹配' : matches.length ? `找到 ${matches.length} 条匹配` : '没有找到匹配内容')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn('全文搜索失败', error)
        setStatus('搜索失败，请重试。')
      }
    }
  }

  return <>
    <form className="reader-search" onSubmit={event => void search(event)}>
      <input autoFocus aria-label="搜索关键词" type="search" value={query} maxLength={150} onChange={event => setQuery(event.target.value)} />
      <button className="primary" disabled={!query.trim()}>搜索</button>
    </form>
    {status && <p role="status">{status}</p>}
    <ul className="chapters">{results.map(({ target, excerpt }, index) => <li key={index}><button onClick={() => jump(target)}>{excerpt}</button></li>)}</ul>
  </>
}
