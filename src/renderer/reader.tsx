import { mobile, mobileBattery, newId, platform, supportsVolumeKeys } from './platform'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { THEMES, type Book, type Chapter, type Mark, type Position, type Settings } from './model'
import type { ReaderEngine, ReaderEvents } from './reader-engine'
import { getCover, saveCover, type BookData } from './reading-data'
import { ReaderSearch } from './reader-search'
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

function BackIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5m7-7-7 7 7 7" />
  </svg>
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
  const [menu, setMenu] = useState(false)
  const [panel, setPanel] = useState<'toc' | 'notes' | 'bookmarks' | 'settings' | 'more' | 'search' | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const cached = useRef<{ revision: number; file: File } | null>(null)
  const lastBack = useRef<{ method: 'click' | 'swipe'; at: number } | null>(null)
  const interact = useRef({ tap: (_ratio: number) => {}, scroll: () => {}, back: (_method: 'click' | 'swipe') => {} })
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
  const ebookMode = book.format === 'pdf' ? null : settings.mode
  const fullPage = panel === 'more' || panel === 'toc'
  const bookmark = position && (menu || panel === 'bookmarks') && marks.find(mark => mark.kind === 'bookmark' &&
    (mark.position.target === position.target || engine.current?.isVisible?.(mark.position.target)))
  const dismiss = () => { setPanel(null); setMenu(false) }
  interact.current = {
    tap(ratio) {
      if (panel) { dismiss(); return }
      if (ratio >= 0.3 && ratio <= 0.7) {
        setMenu(value => !value)
        return
      }
      if (menu) setMenu(false)
      if (settings.mode === 'page' && settings.tap) move(ratio < 0.3 ? -1 : 1)
    },
    scroll() {
      if (panel === 'settings') dismiss()
      else if (!panel && menu) setMenu(false)
    },
    back(method) {
      if (draft) { setDraft(null); return }
      if (panel) { dismiss(); return }
      const now = performance.now()
      const last = lastBack.current
      if (method === 'swipe' && last?.method === method && now - last.at < 120) return
      if (last?.method === method && now - last.at <= 2200) {
        lastBack.current = null
        back()
        return
      }
      lastBack.current = { method, at: now }
      setNotice(method === 'swipe' ? '再次滑动返回' : '再次点击返回')
    }
  }

  const move = useCallback((step: number) => {
    interact.current.scroll()
    void engine.current?.step(step).catch(error => {
      console.error('无法翻页', error)
      setNotice('翻页失败，请重试。')
    })
  }, [])

  const key = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey ||
      (event.target as Element | null)?.closest?.('input, textarea, select, button, [contenteditable]')) return
    if (event.key === 'Escape' || event.key === 'BrowserBack') {
      event.preventDefault()
      interact.current.back('click')
      return
    }
    if (settingsRef.current.mode === 'scroll') {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interact.current.scroll()
      return
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -1, PageDown: 1 }[event.key]
    if (!step) return
    event.preventDefault()
    move(step)
  }, [move])

  useEffect(() => {
    const lifetime = new AbortController()
    let current: ReaderEngine | undefined
    let surface: HTMLDivElement | undefined
    let dirty: Position | undefined
    let firstPosition = true
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const flushPosition = () => {
      clearTimeout(saveTimer)
      saveTimer = undefined
      if (dirty) savePosition(dirty)
      dirty = undefined
    }
    window.addEventListener('pagehide', flushPosition, { signal: lifetime.signal })
    setLoading(true)
    setMissing(false)
    setError('')
    setChapters([])
    async function load() {
      const createEngine = book.format === 'pdf'
        ? import('./pdf-engine').then(module => module.pdfEngine)
        : import('./ebook-engine').then(module => module.ebookEngine)
      const previous = cached.current?.revision === revision ? cached.current.file : null
      const [source, create] = await Promise.all([previous ?? platform.readBook(book.id, lifetime.signal), createEngine])
      if (lifetime.signal.aborted) return
      if (!source) {
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
          dirty = value
          // 首次定位立即进入最近阅读。连续滚动合并写入，退出或换模式时补写最后位置。
          if (firstPosition) {
            firstPosition = false
            flushPosition()
          } else if (!saveTimer) saveTimer = setTimeout(flushPosition, 300)
        },
        cover: getCover(book.id) ? undefined : cover => saveCover(book.id, cover),
        key,
        activity: platform.activity,
        tap: ratio => interact.current.tap(ratio),
        scroll: () => interact.current.scroll(),
        back: () => interact.current.back('swipe')
      }
      if (!host.current) return
      surface = document.createElement('div')
      surface.className = 'engine-surface'
      host.current.append(surface)
      current = create(surface, events, settingsRef.current)
      engine.current = current
      const file = source instanceof File ? source : new File([source], book.name + '.' + book.format)
      cached.current = { revision, file }
      await current.open(file, positionRef.current ?? null)
    }
    void load().catch(error => {
      if (lifetime.signal.aborted) return
      console.error('无法打开书籍', error)
      setError('无法打开这本书。文件可能已损坏、受到保护，或使用了不支持的格式。')
      current?.close()
      surface?.remove()
      engine.current = null
      current = undefined
    }).finally(() => {
      if (!lifetime.signal.aborted) setLoading(false)
    })
    return () => {
      lifetime.abort()
      flushPosition()
      current?.close()
      surface?.remove()
      engine.current = null
    }
  }, [book.id, book.name, book.format, key, move, revision, savePosition, ebookMode])

  useEffect(() => { engine.current?.configure(settings) }, [settings])
  useEffect(() => {
    const offTurn = platform.onTurn(move)
    const offDim = platform.onDim(setDimmed)
    const offBack = platform.onBack?.(method => interact.current.back(method))
    window.addEventListener('keydown', key)
    return () => {
      offTurn()
      offDim()
      offBack?.()
      window.removeEventListener('keydown', key)
    }
  }, [key, move])

  const active = !loading && !error
  const useVolume = supportsVolumeKeys && settings.mode === 'page' && settings.volume
  useEffect(() => {
    let current = true
    void platform.setReading(true, settings.idle, active && useVolume).then(available => {
      if (current) setVolumeAvailable(available)
    }).catch(error => console.error('无法应用阅读模式设置', error))
    return () => { current = false }
  }, [active, settings.idle, useVolume])
  useEffect(() => () => {
    void platform.setReading(false, 0, false).catch(error => console.error('无法结束阅读状态', error))
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 2200)
    return () => clearTimeout(timeout)
  }, [notice])

  function seek(value: number) {
    setPreview(null)
    void engine.current?.seek(value / 1000).catch(error => {
      console.warn('无法拖动阅读进度', error)
      setNotice('无法定位阅读位置。')
    })
  }

  function jump(target: Position['target']) {
    void engine.current?.go(target).then(dismiss).catch(error => {
      console.error('无法定位阅读位置', error)
      setNotice('无法定位阅读位置。')
    })
  }

  function addBookmark() {
    if (!position) return
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
    {(menu || error) && !panel && <header className="reader-toolbar">
      <button className="reader-back" aria-label="返回书库" onClick={() => interact.current.back('click')}><BackIcon /></button>
      <strong title={book.name}>{book.name}</strong>
      <div>
        <button aria-label="快速书签" title="快速书签" aria-pressed={!!bookmark} disabled={!active || !position} onClick={addBookmark}><svg aria-hidden="true" viewBox="0 0 24 24" fill={bookmark ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path d="M6 3h12v18l-6-4-6 4z" /></svg></button>
        <button aria-label="全文搜索" title="全文搜索" disabled={!active} onClick={() => setPanel('search')}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></button>
      </div>
    </header>}
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
      </div>
      <ReaderStatus settings={settings} position={active ? position : undefined} />
    </div>
    {menu && !panel && <nav className="reader-bottom" aria-label="阅读菜单">
      <div className="reader-progress">
        <input type="range" aria-label="阅读进度" min={0} max={1000} value={preview ?? Math.round(1000 * (position?.fraction ??
          (position && position.total > 1 ? (position.page - 1) / (position.total - 1) : 0)))}
          onChange={event => setPreview(+event.target.value)}
          onPointerCancel={() => setPreview(null)}
          onPointerUp={event => seek(+event.currentTarget.value)}
          onKeyUp={event => { if (preview !== null) seek(+event.currentTarget.value) }} />
        <output>{preview !== null ? Math.round(preview / 10) + '%' : position ? `${position.page} / ${position.total}` : '—'}</output>
      </div>
      <div className="reader-actions">
        {([['toc', '☰', '目录'], ['notes', '▤', '笔记'], ['bookmarks', '♧', '书签'], ['settings', '☷', '设置']] as const)
          .map(([value, icon, label]) => <button key={value} onClick={() => setPanel(value)}><span aria-hidden="true">{icon}</span>{label}</button>)}
      </div>
    </nav>}
    {panel && !fullPage && <div className={`reader-scrim${panel === 'settings' ? ' reader-scrim-passive' : ''}`} aria-hidden="true" onClick={dismiss} />}
    {panel && <aside className={fullPage ? 'reader-settings-page' : 'reader-sheet'}
      aria-label={{ toc: '目录', notes: '笔记', bookmarks: '书签', settings: '设置', more: '更多设置', search: '全文搜索' }[panel]}>
      <header className="sheet-heading">
        {fullPage ? <>
          <button className="reader-back" aria-label="返回阅读页" onClick={dismiss}><BackIcon /></button>
          <nav aria-label="面包屑"><button onClick={dismiss}>阅读</button><span aria-hidden="true">›</span>
            <strong>{panel === 'toc' ? '目录' : '更多设置'}</strong></nav>
        </> : <>
          <h2>{{ notes: '笔记', bookmarks: '书签', settings: '阅读设置', search: '全文搜索' }[panel]}</h2>
          <button aria-label="关闭面板" onClick={dismiss}>×</button>
        </>}
      </header>
      {panel === 'toc' && <div className="contents-page">
        {chapters.length ? <ChapterList chapters={chapters} go={jump} /> : <p>目录暂不可用。</p>}
      </div>}
      {(panel === 'settings' || panel === 'more') && <ReaderSettings page={panel === 'more' ? 'more' : 'appearance'}
        value={settings} change={saveSettings} volumeAvailable={volumeAvailable}
        paragraphSpacingAvailable={book.format !== 'pdf' && book.format !== 'cbz'} more={() => setPanel('more')} />}
      {panel === 'search' && <ReaderSearch engine={engine.current} jump={jump} />}
      {(panel === 'notes' || panel === 'bookmarks') && <>
        {panel === 'notes' && <button disabled={!active || !position} onClick={() => position && setDraft({ text: '', position })}>写笔记</button>}
        {panel === 'bookmarks' && <button disabled={!active || !position} onClick={addBookmark}>标记当前位置</button>}
        {marks.filter(mark => mark.kind === (panel === 'notes' ? 'note' : 'bookmark')).map(mark => <article className="mark" key={mark.id}>
          <div><strong>{mark.position.chapter}</strong><small>{mark.position.page}</small></div>
          {mark.text && <p>{mark.text}</p>}
          <button onClick={() => jump(mark.position.target)}>跳转</button>
          {mark.kind === 'note' && <button onClick={() => setDraft({ id: mark.id, text: mark.text, position: mark.position })}>编辑</button>}
          <button onClick={() => saveMarks(marks.filter(item => item.id !== mark.id))}>删除</button>
        </article>)}
      </>}
    </aside>}
    {draft && <div className="modal-backdrop"><form className="note-modal" onSubmit={event => { event.preventDefault(); saveNote() }} role="dialog" aria-modal="true" aria-label="阅读笔记">
      <h2>阅读笔记</h2><p>{draft.position.chapter}</p>
      <textarea autoFocus aria-label="笔记内容" placeholder="记下这一页的想法…" value={draft.text} maxLength={4000} onChange={event => setDraft({ ...draft, text: event.target.value })} />
      <div><button type="button" onClick={() => setDraft(null)}>取消</button><button className="primary" type="submit" disabled={!draft.text.trim()}>保存</button></div>
    </form></div>}
    {notice && <div className="toast" role="status">{notice}</div>}
    {dimmed && <div className="dimmed" aria-label="屏幕已休眠" onPointerDown={() => platform.activity?.()} />}
  </main>
}
