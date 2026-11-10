import { useState } from 'react'
import logo from './assets/sofa-read.svg?url'
import { getCover, type ReadingData } from './reading-data'
import type { Book } from './model'
import { saveUnlockedSources, unlockedSources, type Source, type SourceBook } from './source-client'
import { SourceShelf, SourceUnlock } from './source-shelf'

const byTitle = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true, sensitivity: 'base' })
const colors = ['#475945', '#9c593e', '#324f62', '#70628a', '#ac7e41', '#475956']

/** 在书架与阅读记录中显示原书封面或按书名生成的封面。 */
export function Cover({ book }: { book: Book }) {
  const cover = getCover(book.id)
  if (cover) return <img className="cover" src={cover} alt="" />
  const color = colors[Array.from(book.name).reduce((sum, character) => sum + character.codePointAt(0)!, 0) % colors.length]
  return <span className="cover generated" style={{ backgroundColor: color }} aria-hidden="true">
    <small>{book.format.toUpperCase()}</small>
    <strong>{book.name}</strong>
    <span>SOFA READ</span>
  </span>
}

interface ShelfProps {
  books: Book[]
  data: ReadingData
  open(book: Book): void
  importBooks(): void
  download(book: SourceBook): Promise<Book>
  busy: boolean
  remove(book: Book): void
  update(data: ReadingData): void
}

export function Shelf({ books, data, open, importBooks, download, busy, remove, update }: ShelfProps) {
  const [chosenTab, setTab] = useState<'shelf' | 'history' | 'sources' | null>(null)
  const [sources, setSources] = useState(unlockedSources)
  const [source, setSource] = useState<Source>()
  const [filter, setFilter] = useState<string | null>(null)
  const [sort, setSort] = useState(localStorage.getItem('shelf-sort') ?? 'date')
  const [category, setCategory] = useState('')
  const visible = books.filter(book => filter === null || (data.books[book.id]?.category ?? '') === filter)
    .sort((a, b) => sort === 'name' ? byTitle.compare(a.name, b.name) : b.added - a.added)
  const history = books.filter(book => data.books[book.id]?.lastRead)
    .sort((a, b) => (data.books[b.id].lastRead ?? 0) - (data.books[a.id].lastRead ?? 0)).slice(0, 5)
  const tab = chosenTab ?? (history.length ? 'history' : 'shelf')

  function unlock(item: Source) {
    const next = sources.includes(item) ? sources : [...sources, item]
    saveUnlockedSources(next)
    setSources(next)
    setSource(item)
    setTab('sources')
  }

  function addCategory() {
    const name = category.trim()
    if (!name || data.categories.includes(name)) return
    update({ ...data, categories: [...data.categories, name] })
    setCategory('')
  }

  return <main className="library">
    <header className="library-header">
      <div className="brand"><img className="brand-mark" src={logo} alt="" /><span>Sofa Read</span></div>
      <nav aria-label="书库">
        <button className={tab === 'shelf' ? 'selected' : ''} onClick={() => setTab('shelf')}>书架</button>
        <button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>阅读记录</button>
        {sources.length > 0 && <button className={tab === 'sources' ? 'selected' : ''} onClick={() => setTab('sources')}>书源</button>}
      </nav>
      <div className="library-imports">
        <button className="primary" onClick={importBooks} disabled={busy}>{busy ? '正在导入…' : '＋ 导入书籍'}</button>
        <SourceUnlock accept={unlock} />
      </div>
    </header>
    {tab === 'sources' ? <SourceShelf key={source ?? sources[0]} source={source ?? sources[0]}
      sources={sources} choose={setSource} books={books} download={download} open={open} /> : tab === 'shelf' ? <div className="library-body">
      <aside className="categories">
        <h2>分类</h2>
        <button className={filter === null ? 'selected' : ''} onClick={() => setFilter(null)}>全部书籍 <span>{books.length}</span></button>
        <button className={filter === '' ? 'selected' : ''} onClick={() => setFilter('')}>未分类</button>
        {data.categories.map(name => <button key={name} className={filter === name ? 'selected' : ''} onClick={() => setFilter(name)}>{name}</button>)}
        <form onSubmit={event => { event.preventDefault(); addCategory() }}>
          <input aria-label="新分类名称" placeholder="新分类" maxLength={24} value={category} onChange={event => setCategory(event.target.value)} />
          <button type="submit" aria-label="创建分类" disabled={!category.trim()}>＋</button>
        </form>
      </aside>
      <section className="collection">
        <div className="section-head"><div><p className="eyebrow">本地书库</p><h1>{(filter ?? '我的书架') || '未分类'}</h1></div>
          <label>排序 <select value={sort} onChange={event => { setSort(event.target.value); localStorage.setItem('shelf-sort', event.target.value) }}>
            <option value="date">导入时间</option><option value="name">书名首字母</option>
          </select></label>
        </div>
        {visible.length ? <div className="book-grid">
          {visible.map(book => <article className="book-card" key={book.id}>
            <button className="open-card" onClick={() => open(book)}><Cover book={book} /><strong title={book.name}>{book.name}</strong></button>
            <div className="card-actions">
              <select aria-label={`${book.name}的分类`} value={data.books[book.id]?.category ?? ''} onChange={event =>
                update({ ...data, books: { ...data.books, [book.id]: { ...data.books[book.id], category: event.target.value } } })}>
                <option value="">未分类</option>
                {data.categories.map(name => <option key={name}>{name}</option>)}
              </select>
              <button aria-label={`移除${book.name}`} title="从书架移除" onClick={() => remove(book)}>×</button>
            </div>
          </article>)}
        </div> : <div className="empty"><span aria-hidden="true">▤</span><h2>{books.length ? '这个分类还没有书' : '书架还是空的'}</h2><p>{books.length ? '可以在书籍下方选择分类。' : '从本机选择电子书，开始阅读。'}</p>
          {!books.length && <button className="primary" onClick={importBooks} disabled={busy}>导入第一本书</button>}</div>}
      </section>
    </div> : <section className="history">
      <p className="eyebrow">最近打开</p><h1>阅读记录</h1>
      {history.length ? <>
        <article className="history-feature">
          <Cover book={history[0]} />
          <div><p className="eyebrow">正在阅读</p><h2>{history[0].name}</h2><p>{data.books[history[0].id].position?.chapter}</p></div>
          <button className="primary" onClick={() => open(history[0])}>继续</button>
        </article>
        {!!history.slice(1).length && <h2 className="history-list-title">最近阅读</h2>}
        {history.slice(1).map(book => <article className="history-row" key={book.id}>
          <Cover book={book} /><div><h3>{book.name}</h3><p>{data.books[book.id].position?.chapter}</p></div>
          <button onClick={() => open(book)}>继续</button>
        </article>)}
      </> : <div className="empty"><h2>还没有阅读记录</h2><p>打开一本书后，可以从这里继续阅读。</p></div>}
    </section>}
  </main>
}
