import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Book } from '../shared/book'
import { downloadId } from './downloaded-library'
import { SOURCE_QUERY_LIMIT } from '../shared/source-network'
import { SourceResults } from './source-results'
import { onlineChapter, onlineContents, NOVEL_CATEGORIES, SOURCE_NAMES, sourceForKey, type OnlineChapter, type OnlineContents, type Source, type SourceBook } from './source-client'

/** 网络导入入口以本地口令解锁内置书源。 */
export function SourceUnlock({ accept }: { accept(source: Source): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const source = sourceForKey(address)
    if (!source) {
      setError('这个地址暂时无法导入。')
      return
    }
    try {
      accept(source)
      dialog.current?.close()
    } catch (error) {
      console.error('无法保存书源设置', error)
      setError('无法保存书源，请检查本地存储后重试。')
    }
  }

  return <>
    <button onClick={() => {
      setAddress('')
      setError('')
      dialog.current?.showModal()
    }}>网络导入</button>
    <dialog ref={dialog} className="source-dialog" aria-labelledby="source-import-title">
      <form onSubmit={submit}>
        <h2 id="source-import-title">网络导入</h2>
        <label htmlFor="source-address">网址</label>
        <input id="source-address" autoFocus type="text" inputMode="url" autoCapitalize="none" autoComplete="off"
          maxLength={2048} value={address} onChange={event => { setAddress(event.target.value); setError('') }} />
        {error && <p role="alert">{error}</p>}
        <div className="source-actions">
          <button type="button" onClick={() => dialog.current?.close()}>取消</button>
          <button type="submit" className="primary" disabled={!address.trim()}>继续</button>
        </div>
      </form>
    </dialog>
  </>
}

function SerialContents({ book, choose, close }: { book: SourceBook; choose(cursor: string): void; close(): void }) {
  const [request, setRequest] = useState({ cursor: '', attempt: 0 })
  const [entries, setEntries] = useState<OnlineContents['entries']>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    const lifetime = new AbortController()
    onlineContents(book, request.cursor, lifetime.signal).then(page => {
      if (lifetime.signal.aborted) return
      seen.current.add(request.cursor)
      setEntries(previous => {
        const known = new Set(previous.map(entry => entry.cursor))
        return [...previous, ...page.entries.filter(entry => !known.has(entry.cursor))]
      })
      setNext(page.next && !seen.current.has(page.next) ? page.next : null)
    }).catch(error => {
      if (lifetime.signal.aborted) return
      console.warn('无法读取在线目录', error)
      setError(true)
    }).finally(() => {
      if (!lifetime.signal.aborted) setBusy(false)
    })
    return () => lifetime.abort()
  }, [book, request])

  function load(cursor: string) {
    setBusy(true)
    setError(false)
    setRequest(previous => ({ cursor, attempt: previous.attempt + 1 }))
  }

  return <section className="source-contents" aria-label="在线目录">
    <header className="source-actions"><button onClick={close}>返回正文</button><h2>目录</h2></header>
    <ol>{entries.map(entry => <li key={entry.cursor}><button onClick={() => choose(entry.cursor)}>{entry.title}</button></li>)}</ol>
    {busy && <p role="status">正在加载目录…</p>}
    {error && <div className="source-actions"><p role="alert">暂时无法加载目录。</p><button onClick={() => load(request.cursor)}>重试目录</button></div>}
    {!busy && !error && next && <button onClick={() => load(next)}>加载更多章节</button>}
  </section>
}

function SerialReader({ book, close }: { book: SourceBook; close(): void }) {
  const [request, setRequest] = useState({ cursor: '', attempt: 0 })
  const [chapter, setChapter] = useState<OnlineChapter>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [contents, setContents] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const lifetime = new AbortController()
    onlineChapter(book, request.cursor, lifetime.signal).then(value => {
      if (lifetime.signal.aborted) return
      setChapter(value)
      title.current?.scrollIntoView({ block: 'start' })
    }).catch(error => {
      if (lifetime.signal.aborted) return
      console.warn('无法读取在线章节', error)
      setError('暂时无法加载这一节。')
    }).finally(() => {
      if (!lifetime.signal.aborted) setLoading(false)
    })
    return () => lifetime.abort()
  }, [book, request])

  function go(cursor: string) {
    setLoading(true)
    setError('')
    setRequest(previous => ({ cursor, attempt: previous.attempt + 1 }))
  }

  return <article className="source-reader" aria-label="在线阅读">
    <div className="source-actions"><button onClick={close}>返回书源</button>
      {!contents && <button onClick={() => setContents(true)}>目录</button>}
    </div>
    {contents && <SerialContents book={book} close={() => setContents(false)}
      choose={cursor => { setContents(false); go(cursor) }} />}
    <div hidden={contents} className="source-reading-body">
      <h1 ref={title}>{book.title}</h1>
      <p className="eyebrow">{book.details}</p>
      {loading && <p role="status">正在加载章节…</p>}
      {error && <div className="source-actions"><p role="alert">{error}</p><button onClick={() => go(request.cursor)}>重试</button></div>}
      {chapter && <>
        <h2>{chapter.title}</h2>
        <p className="source-reader-text">{chapter.text}</p>
        <div className="source-actions">
          <button disabled={loading || !chapter.previous} onClick={() => chapter.previous && go(chapter.previous)}>上一节</button>
          <button disabled={loading || !chapter.next} onClick={() => chapter.next && go(chapter.next)}>下一节</button>
        </div>
      </>}
    </div>
  </article>
}

interface SourceShelfProps {
  sources: Source[]
  source: Source
  choose(source: Source): void
  books: Book[]
  download(book: SourceBook): Promise<Book>
  open(book: Book): void
}

/** 已解锁书源共用书库标签，按书籍提供下载或在线章节。 */
export function SourceShelf({ sources, source, choose, books, download, open }: SourceShelfProps) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const [category, setCategory] = useState(0)
  const browsing = query && scope === 'all' ? sources : [source]
  const [reading, setReading] = useState<SourceBook>()
  const [pending, setPending] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const lifetime = useRef<AbortController | null>(null)
  const working = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(input.trim().replace(/\s+/g, ' '))
  }

  async function getBook(book: SourceBook, read: boolean) {
    const local = books.find(item => item.id === downloadId(book.id))
    if (local) {
      if (read) open(local)
      return
    }
    if (working.current) return
    working.current = true
    const scope = lifetime.current
    setPending(book.id)
    setError('')
    setNotice('')
    try {
      const result = await download(book)
      if (scope?.signal.aborted) return
      if (read) open(result)
      else setNotice('已下载到书架。')
    } catch (error) {
      if (scope?.signal.aborted) return
      console.warn('无法下载书源书籍', error)
      setError('暂时无法下载这本书，请稍后重试。')
    } finally {
      working.current = false
      if (!scope?.signal.aborted) setPending('')
    }
  }

  return <>
    {reading && <SerialReader book={reading} close={() => setReading(undefined)} />}
    <div hidden={!!reading}>
      <section className="source-shelf">
        <h1>书源</h1>
        <div className="source-actions" role="group" aria-label="已解锁书源">
          {sources.map(item => <button key={item} aria-pressed={item === source} onClick={() => choose(item)}>{SOURCE_NAMES[item]}</button>)}
        </div>
        <form className="source-actions source-search" onSubmit={search}>
          <input aria-label="书名或作者" placeholder="书名或作者" type="search" value={input} maxLength={SOURCE_QUERY_LIMIT}
            onChange={event => setInput(event.target.value)} />
          <select aria-label="书源搜索范围" value={scope} onChange={event => setScope(event.target.value === 'all' ? 'all' : 'current')}>
            <option value="all">全部已解锁书源</option><option value="current">当前书源</option>
          </select>
          <button type="submit">搜索书源</button>
          {query && <button type="button" onClick={() => { setInput(''); setQuery('') }}>清除搜索</button>}
        </form>
        {source === 'serial' && !query && <label className="source-category">网文分类
          <select value={category} onChange={event => setCategory(Number(event.target.value))}>
            {NOVEL_CATEGORIES.map((label, index) => <option key={label} value={index}>{label}</option>)}
          </select>
        </label>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <SourceResults key={JSON.stringify([browsing, query, query ? 0 : category])} sources={browsing} query={query} category={query ? 0 : category}
          render={book => {
            const saved = books.some(item => item.id === downloadId(book.id))
            return <article className="source-book" key={book.id}>
              <div><h2>{book.title}</h2><p>{book.details}</p></div>
              <div className="source-actions">
                {book.format && <button disabled={saved || !!pending} onClick={() => void getBook(book, false)}>
                  {saved ? '已下载' : pending === book.id ? '正在下载…' : '下载'}
                </button>}
                <button disabled={!!pending} onClick={() => book.format ? void getBook(book, true) : setReading(book)}>阅读</button>
              </div>
            </article>
          }} />
      </section>
    </div>
  </>
}
