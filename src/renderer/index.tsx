import { platform } from './platform'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { readSettings, type Book, type Mark, type Position, type Settings } from './model'
import { readData, saveData, type ReadingData } from './reading-data'
import { Shelf } from './shelf'
import { Reader } from './reader'
import { downloadId, saveDownload } from './downloaded-library'
import { sourceDownload, type SourceBook } from './source-client'
import './styles.css'

function App() {
  const [libraryReady, setLibraryReady] = useState(false)
  const [books, setBooks] = useState<Book[]>([])
  const [active, setActive] = useState<Book | null>(null)
  const [data, setData] = useState(readData)
  const dataRef = useRef(data)
  const [settings, setSettings] = useState(readSettings)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const downloads = useRef(new Map<string, Promise<Book>>())

  const updateData = useCallback((next: ReadingData) => {
    dataRef.current = next
    setData(next)
    try {
      saveData(next)
    } catch (error) {
      console.error('无法保存阅读数据', error)
      setMessage('本地存储空间不足，部分阅读数据可能无法保存。')
    }
  }, [])

  useEffect(() => {
    void platform.listBooks().then(setBooks).catch(error => {
      console.error('无法加载书架', error)
      setMessage('无法加载本地书架。')
    }).finally(() => setLibraryReady(true))
  }, [])

  useEffect(() => {
    if (!message) return
    const timeout = setTimeout(() => setMessage(''), 3000)
    return () => clearTimeout(timeout)
  }, [message])

  const updatePosition = useCallback((position: Position) => {
    if (!active) return
    const current = dataRef.current
    updateData({ ...current, books: { ...current.books, [active.id]: { ...current.books[active.id], position, lastRead: Date.now() } } })
  }, [active?.id, updateData])

  function updateMarks(marks: Mark[]) {
    if (!active) return
    const current = dataRef.current
    updateData({ ...current, books: { ...current.books, [active.id]: { ...current.books[active.id], marks } } })
  }

  async function importBooks() {
    setBusy(true)
    try {
      const imported = await platform.importBooks()
      setBooks(previous => [...previous.filter(book => !imported.some(item => item.id === book.id)), ...imported])
    } catch (error) {
      console.error('无法导入书籍', error)
      setMessage('导入失败。请检查文件格式及读取权限。')
    } finally {
      setBusy(false)
    }
  }

  function download(source: SourceBook) {
    const id = downloadId(source.id)
    const existing = books.find(book => book.id === id)
    if (existing) return Promise.resolve(existing)
    const pending = downloads.current.get(id)
    if (pending) return pending
    const format = source.format
    if (!format) return Promise.reject(new Error('这本书暂未提供下载。'))
    const task = (async () => {
      const content = await sourceDownload(source)
      const book = { id, name: source.title, format, added: Date.now(), bytes: content.size }
      await saveDownload(book, content)
      setBooks(previous => [...previous.filter(item => item.id !== id), book])
      return book
    })().finally(() => downloads.current.delete(id))
    downloads.current.set(id, task)
    return task
  }

  async function remove(book: Book) {
    if (!window.confirm(`从书架移除《${book.name}》及其阅读记录？`)) return
    try {
      await platform.removeBook(book.id)
      setBooks(previous => previous.filter(item => item.id !== book.id))
      const current = dataRef.current
      const next = { ...current.books }
      delete next[book.id]
      updateData({ ...current, books: next })
      localStorage.removeItem('cover:' + book.id)
    } catch (error) {
      console.error('无法移除书籍', error)
      setMessage('无法从书架移除书籍。')
    }
  }

  async function relink() {
    if (!active) return false
    const updated = await platform.relinkBook(active.id)
    if (!updated) return false
    setBooks(previous => previous.map(book => book.id === updated.id ? updated : book))
    setActive(updated)
    return true
  }

  function saveSettings(next: Settings) {
    setSettings(next)
    try {
      localStorage.setItem('settings', JSON.stringify(next))
    } catch (error) {
      console.error('无法保存阅读设置', error)
      setMessage('本地存储空间不足，设置可能无法保存。')
    }
  }

  return <>
    <div hidden={!!active}>
      {!libraryReady ? <p className="library-loading" role="status">正在读取书库…</p> : <Shelf books={books} data={data} open={setActive} busy={busy} update={updateData}
        importBooks={() => void importBooks()} download={download} remove={book => void remove(book)} />}
    </div>
    {active && <Reader key={active.id} book={active} data={data.books[active.id] ?? {}} settings={settings}
      savePosition={updatePosition} saveMarks={updateMarks} saveSettings={saveSettings} relink={relink} back={() => setActive(null)} />}
    {message && <div className="toast" role="alert">{message}</div>}
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
