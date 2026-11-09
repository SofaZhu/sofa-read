import { mobile, mobileBattery, newId, platform, supportsVolumeKeys } from './platform'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { THEMES, type Book, type Chapter, type Mark, type Position, type Settings } from './model'
import type { ReaderEngine, ReaderEvents } from './reader-engine'
import { getCover, saveCover, type BookData } from './reading-data'
import { ReaderSettings } from './settings'

interface Battery extends EventTarget {
  level: number
  charging: boolean
}

function ReaderStatus({ settings, position }: { settings: Settings; position?: Position }) {
  const [time, setTime] = useState(new Date())
  const [battery, setBattery] = useState('')
  useEffect(() => {
    if (!settings.clock) return
    setTime(new Date())
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [settings.clock])

  useEffect(() => {
    if (!settings.battery) return
    const lifetime = new AbortController()
    if (mobile) {
      const update = async () => {
        try {
          const value = await mobileBattery()
          if (value && !lifetime.signal.aborted) setBattery(`电量 ${Math.round(value.level * 100)}%${value.charging ? ' · 充电中' : ''}`)
        } catch (error) {
          console.debug('无法读取移动端电量', error)
        }
      }
      void update()
      const timer = setInterval(() => void update(), 30_000)
      return () => { lifetime.abort(); clearInterval(timer) }
    }
    const browser = navigator as Navigator & { getBattery?: () => Promise<Battery> }
    void browser.getBattery?.().then(value => {
      if (lifetime.signal.aborted) return
      const update = () => setBattery(`电量 ${Math.round(value.level * 100)}%${value.charging && value.level < 1 ? ' · 充电中' : ''}`)
      value.addEventListener('levelchange', update, { signal: lifetime.signal })
      value.addEventListener('chargingchange', update, { signal: lifetime.signal })
      update()
    }).catch(() => setBattery(''))
    return () => lifetime.abort()
  }, [settings.battery])

  return <footer className="reading-status">
    <div>{settings.battery && <span>{battery || '电量不可用'}</span>}
      {settings.clock && <time>{time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>}</div>
    {position && <span title={position.estimated ? '按内容长度估算的位置' : '文档页码'}>{position.estimated ? '约 ' : ''}{position.page} / {position.total}</span>}
  </footer>
}

function ChapterList({ chapters, go }: { chapters: Chapter[]; go(target: Position['target']): void }) {
  return <ul className="chapters">{chapters.map((chapter, index) => <li key={index}>
    <button onClick={() => go(chapter.target)}>{chapter.label}</button>
    {!!chapter.children?.length && <ChapterList chapters={chapter.children} go={go} />}
  </li>)}</ul>
}

interface ReaderProps {
  book: Book
  data: BookData
  settings: Settings
  saveSettings(settings: Settings): void
  savePosition(position: Position): void
  saveMarks(marks: Mark[]): void
  relink(): Promise<boolean>
  back(): void
}

export function Reader({ book, data, settings, saveSettings, savePosition, saveMarks, relink, back }: ReaderProps) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<ReaderEngine | null>(null)
  const positionRef = useRef(data.position)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [position, setPosition] = useState(data.position)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [panel, setPanel] = useState<'toc' | 'marks' | 'settings' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [dimmed, setDimmed] = useState(false)
  const [volumeAvailable, setVolumeAvailable] = useState(true)
  const [draft, setDraft] = useState<{ text: string; position: Position; id?: string } | null>(null)
  const marks = data.marks ?? []
  const theme = THEMES[settings.theme]

  const move = useCallback((step: number) => {
    void engine.current?.step(step).catch(error => {
      console.error('无法翻页', error)
      setNotice('翻页失败，请重试。')
    })
  }, [])

  const key = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey ||
      (event.target as Element | null)?.closest?.('input, textarea, select, button, [contenteditable]')) return
    if (settingsRef.current.mode !== 'page') return
    const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -1, PageDown: 1 }[event.key]
    if (!step) return
    event.preventDefault()
    move(step)
  }, [move])

  useEffect(() => {
    const lifetime = new AbortController()
    let current: ReaderEngine | undefined
    setLoading(true)
    setMissing(false)
    setError('')
    setChapters([])
    async function load() {
      const bytes = await platform.readBook(book.id, lifetime.signal)
      if (lifetime.signal.aborted) return
      if (!bytes) {
        setMissing(true)
        setError('找不到书籍原文件，或文件已无法读取。')
        return
      }
      const events: ReaderEvents = {
        chapters: value => { if (!lifetime.signal.aborted) setChapters(value) },
        position: value => {
          if (lifetime.signal.aborted) return
          positionRef.current = value
          setPosition(value)
          savePosition(value)
        },
        cover: getCover(book.id) ? undefined : cover => saveCover(book.id, cover),
        key,
        activity: platform.activity,
        tap(event, width) {
          const value = settingsRef.current
          if (value.mode !== 'page' || !value.tap || event.defaultPrevented) return
          if (event.clientX < width * 0.3) move(-1)
          if (event.clientX > width * 0.7) move(1)
        }
      }
      const create = book.format === 'pdf'
        ? (await import('./pdf-engine')).pdfEngine
        : (await import('./ebook-engine')).ebookEngine
      if (lifetime.signal.aborted || !host.current) return
      current = create(host.current, events, settingsRef.current)
      engine.current = current
      const file = new File([bytes], book.name + '.' + book.format)
      await current.open(file, positionRef.current ?? null)
    }
    void load().catch(error => {
      if (lifetime.signal.aborted) return
      console.error('无法打开书籍', error)
      setError('无法打开这本书。文件可能已损坏、受到保护，或使用了不支持的格式。')
      current?.close()
      engine.current = null
      current = undefined
    }).finally(() => {
      if (!lifetime.signal.aborted) setLoading(false)
    })
    return () => {
      lifetime.abort()
      current?.close()
      engine.current = null
    }
  }, [book.id, book.name, book.format, key, move, revision, savePosition])

  useEffect(() => { engine.current?.configure(settings) }, [settings])
  useEffect(() => {
    const offTurn = platform.onTurn(move)
    const offDim = platform.onDim(setDimmed)
    window.addEventListener('keydown', key)
    return () => {
      offTurn()
      offDim()
      window.removeEventListener('keydown', key)
    }
  }, [key, move])

  const active = !loading && !error
  const useVolume = supportsVolumeKeys && settings.mode === 'page' && settings.volume
  useEffect(() => {
    let current = true
    void platform.setReading(active, settings.idle, useVolume).then(available => {
      if (current) setVolumeAvailable(available)
    }).catch(error => console.error('无法应用阅读模式设置', error))
    return () => { current = false }
  }, [active, settings.idle, useVolume])
  useEffect(() => () => {
    void platform.setReading(false, 0, false).catch(error => console.error('无法结束阅读状态', error))
  }, [])

  function jump(target: Position['target']) {
    void engine.current?.go(target).then(() => setPanel(null)).catch(error => {
      console.error('无法定位阅读位置', error)
      setNotice('无法定位阅读位置。')
    })
  }

  function addBookmark() {
    if (!position) return
    const bookmark = marks.find(mark => mark.kind === 'bookmark' && mark.position.target === position.target)
    if (bookmark) {
      saveMarks(marks.filter(mark => mark.id !== bookmark.id))
      setNotice('已移除当前位置的书签')
    } else {
      saveMarks([{ id: newId(), kind: 'bookmark', position, text: '' }, ...marks])
      setNotice('已添加书签')
    }
  }

  function saveNote() {
    const text = draft?.text.trim()
    if (!draft || !text) return
    if (draft.id) saveMarks(marks.map(mark => mark.id === draft.id ? { ...mark, text } : mark))
    else saveMarks([{ id: newId(), kind: 'note', text, position: draft.position }, ...marks])
    setDraft(null)
    setNotice('已保存笔记')
  }

  return <main className="reader" style={{ '--paper': settings.background || theme.bg, '--ink': theme.fg, '--brightness': settings.brightness / 100 } as CSSProperties}>
    <header className="reader-toolbar">
      <button onClick={back}>‹ 返回书库</button>
      <strong title={book.name}>{book.name}</strong>
      <div>
        <button aria-pressed={panel === 'toc'} onClick={() => setPanel(panel === 'toc' ? null : 'toc')}>目录</button>
        <button disabled={!active || !position} onClick={addBookmark}>书签</button>
        <button disabled={!active || !position} onClick={() => position && setDraft({ text: '', position })}>写笔记</button>
        <button aria-pressed={panel === 'marks'} onClick={() => setPanel(panel === 'marks' ? null : 'marks')}>笔记和书签</button>
        <button aria-pressed={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>设置</button>
      </div>
    </header>
    <div className="reading-paper">
      <div className="chapter-line">{settings.chapter && position?.chapter}</div>
      <div className="reading-body">
        <div ref={host} className={`engine ${settings.theme === 'dark' ? 'dark-pdf' : ''}`} />
        {(loading || error) && <div className="reading-message" role={error ? 'alert' : 'status'}>
          <p>{error || '正在打开书籍…'}</p>
          {missing && <button className="primary" onClick={() => {
            void relink().then(changed => { if (changed) setRevision(value => value + 1) })
              .catch(() => setNotice('请选择与原书格式相同的文件。'))
          }}>重新定位原文件</button>}
        </div>}
        {active && (settings.mode === 'page' || book.format !== 'pdf') && <div className="page-controls">
          <button aria-label={settings.mode === 'page' ? '上一页' : '向后滚动'} onClick={() => move(-1)}>‹</button>
          <button aria-label={settings.mode === 'page' ? '下一页' : '向前滚动'} onClick={() => move(1)}>›</button>
        </div>}
      </div>
      <ReaderStatus settings={settings} position={active ? position : undefined} />
    </div>
    {panel && <aside className="reader-panel" aria-label={panel === 'toc' ? '目录' : panel === 'settings' ? '设置' : '笔记和书签'}>
      <div className="panel-head"><h2>{panel === 'toc' ? '目录' : panel === 'settings' ? '阅读设置' : '笔记和书签'}</h2>
        <button aria-label="关闭侧栏" onClick={() => setPanel(null)}>×</button></div>
      {panel === 'toc' && (chapters.length ? <ChapterList chapters={chapters} go={jump} /> : <p>目录暂不可用。</p>)}
      {panel === 'settings' && <ReaderSettings value={settings} change={saveSettings} volumeAvailable={volumeAvailable} />}
      {panel === 'marks' && (marks.length ? marks.map(mark => <article className="mark" key={mark.id}>
        <div><strong>{mark.kind === 'note' ? '笔记' : '书签'}</strong><small>{mark.position.chapter} · {mark.position.page}</small></div>
        {mark.text && <p>{mark.text}</p>}
        <button onClick={() => jump(mark.position.target)}>跳转</button>
        {mark.kind === 'note' && <button onClick={() => setDraft({ id: mark.id, text: mark.text, position: mark.position })}>编辑</button>}
        <button onClick={() => saveMarks(marks.filter(item => item.id !== mark.id))}>删除</button>
      </article>) : <p>还没有笔记或书签。</p>)}
    </aside>}
    {draft && <div className="modal-backdrop"><form className="note-modal" onSubmit={event => { event.preventDefault(); saveNote() }} role="dialog" aria-modal="true" aria-label="阅读笔记">
      <h2>阅读笔记</h2><p>{draft.position.chapter}</p>
      <textarea autoFocus aria-label="笔记内容" placeholder="记下这一页的想法…" value={draft.text} maxLength={4000} onChange={event => setDraft({ ...draft, text: event.target.value })} />
      <div><button type="button" onClick={() => setDraft(null)}>取消</button><button className="primary" type="submit" disabled={!draft.text.trim()}>保存</button></div>
    </form></div>}
    {notice && <button className="toast" role="status" onClick={() => setNotice('')}>{notice} <span aria-hidden="true">×</span></button>}
    {dimmed && <div className="dimmed" aria-label="屏幕已休眠" onPointerDown={() => platform.activity?.()} />}
  </main>
}
