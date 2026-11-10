import { CapacitorHttp } from '@capacitor/core'
import type JSZip from 'jszip'
import { SOURCE_FILE_LIMIT, sourceHeaders, sourceRequestLimit } from '../shared/source-network'
import { mobile, platform } from './platform'
import { decodeText } from './text-book'

export const SOURCE_NAMES = {
  chinese: '经典中文书籍',
  western: '经典西方书籍',
  serial: '网络小说'
} as const

export type Source = keyof typeof SOURCE_NAMES

export interface SourceBook {
  id: string
  title: string
  details: string
  format: 'epub' | 'txt' | null
}

export interface SourcePage {
  books: SourceBook[]
  next: string | null
  warning?: string
}

export const NOVEL_CATEGORIES = ['全部', '玄幻魔法', '武侠修真', '都市言情', '历史军事', '科幻灵异', '游戏竞技', '女生耽美', '其他类型'] as const

export interface OnlineChapter {
  title: string
  text: string
  previous: string | null
  next: string | null
}

const UNLOCK_KEY = 'unlocked-sources'
const SOURCES: Record<string, Source> = { 'www.4396777.sy': 'chinese', 'www.4396776.sy': 'western', 'www.4396778.sy': 'serial' }
const GUTENBERG = 'https://www.gutenberg.org'
const WIKI_EXPORT = 'https://ws-export.wmcloud.org/'
const BIQU = 'https://www.xwbqgzw.com'
const AIXIA = 'https://down7.ixdzs8.tw'
const ATOM = 'http://www.w3.org/2005/Atom'
const ACQUISITION = 'http://opds-spec.org/acquisition'

const editions = [
  { id: 'west-tea', title: '巴黎茶花女遗事', details: '小仲马 · 林纾、王寿昌译 · 维基文库', page: '巴黎茶花女遺事' },
  { id: 'west-aesop', title: '伊索寓言', details: '伊索 · 林纾、严培南、严璩译 · 维基文库', page: '伊索寓言_(林紓)' },
  { id: 'west-dream', title: '仲夏夜之梦', details: '威廉·莎士比亚 · 朱生豪译 · 维基文库', page: '莎士比亞戲劇全集_(朱生豪)/仲夏夜之夢' }
] as const

const aixia: SourceBook[] = [
  { id: 'ix-501204', title: '折下', details: '古离 · 爱下电子书 · 站点收录版本', format: 'txt' },
  { id: 'ix-200792', title: '斗破苍穹神之炎帝', details: '柠檬邱霞 · 爱下电子书', format: 'txt' }
]

export function sourceForKey(value: string): Source | undefined {
  const key = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  return Object.hasOwn(SOURCES, key) ? SOURCES[key] : undefined
}

export function unlockedSources(): Source[] {
  return (localStorage.getItem(UNLOCK_KEY) ?? '').split(',').filter((key): key is Source => Object.hasOwn(SOURCE_NAMES, key))
}

export function saveUnlockedSources(sources: Source[]) {
  localStorage.setItem(UNLOCK_KEY, sources.join(','))
}

async function receive(input: URL, signal?: AbortSignal, query?: string): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted()
  const initialLimit = sourceRequestLimit(input, query)
  if (!initialLimit) throw new Error('书源地址不可用。')
  if (!mobile) {
    if (!platform.fetchSource) throw new Error('书源连接不可用。')
    const bytes = await platform.fetchSource(input.href, query)
    signal?.throwIfAborted()
    return bytes
  }
  let url = input
  for (let hop = 0; hop < 5; hop++) {
    const limit = sourceRequestLimit(url, query)
    if (!limit) throw new Error('书源跳转地址不可用。')
    const result = await CapacitorHttp.request({
      url: url.href,
      method: query === undefined ? 'GET' : 'POST',
      headers: sourceHeaders(url, query),
      ...(query === undefined ? {} : { data: { s: query } }),
      disableRedirects: true,
      connectTimeout: 12_000,
      readTimeout: 20_000,
      responseType: 'arraybuffer'
    })
    signal?.throwIfAborted()
    if (result.status >= 300 && result.status < 400) {
      const location = Object.entries(result.headers).find(([key]) => key.toLowerCase() === 'location')?.[1]
      if (!location || query !== undefined) break
      url = new URL(location, url)
      continue
    }
    if (result.status !== 200 || typeof result.data !== 'string' || !result.data ||
      result.data.length > Math.ceil(limit / 3) * 4) throw new Error('书源没有返回可用内容。')
    const binary = atob(result.data)
    if (binary.length > limit) throw new Error('书源文件超过大小限制。')
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  }
  throw new Error('书源跳转失败。')
}

async function documentFrom(url: URL, type: 'text/html' | 'text/xml', signal?: AbortSignal, query?: string) {
  const bytes = await receive(url, signal, query)
  const text = new TextDecoder().decode(bytes)
  return new DOMParser().parseFromString(text, type)
}

async function chineseCatalog(start: string, signal: AbortSignal, query: string): Promise<SourcePage> {
  const url = new URL('/ebooks/search.opds/?query=l.zh', GUTENBERG)
  if (query) url.searchParams.set('query', 'l.zh ' + query)
  if (start) url.searchParams.set('start_index', start)
  const document = await documentFrom(url, 'text/xml', signal)
  const root = document.documentElement
  if (root.namespaceURI !== ATOM || root.localName !== 'feed') throw new Error('书源未返回有效目录。')
  const books = Array.from(root.getElementsByTagNameNS(ATOM, 'entry')).flatMap((entry): SourceBook[] => {
    const details = entry.getElementsByTagNameNS(ATOM, 'content')[0]?.textContent?.trim()
    const title = entry.getElementsByTagNameNS(ATOM, 'title')[0]?.textContent?.trim()
    const link = Array.from(entry.getElementsByTagNameNS(ATOM, 'link')).find(link => link.getAttribute('rel') === 'subsection')
    const id = link?.getAttribute('href')?.match(/^\/ebooks\/(\d{1,8})\.opds$/)?.[1]
    return id && title ? [{ id: 'pg-' + id, title, details: [details, '古登堡计划'].filter(Boolean).join(' · '), format: 'epub' }] : []
  })
  const nextLink = Array.from(root.children).find(link => link.getAttribute('rel') === 'next')?.getAttribute('href')
  const next = nextLink && new URL(nextLink, url).searchParams.get('start_index')
  return { books, next: next && /^\d{1,6}$/.test(next) ? next : null }
}

function matchesBook(book: Pick<SourceBook, 'title' | 'details'>, query: string) {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
  return normalize(book.title + ' ' + book.details).includes(normalize(query))
}

async function novelCatalog(start: string, signal: AbortSignal, query: string, category: number): Promise<SourcePage> {
  const initial = !start && category === 0
  const sample = { id: 'bi-766', title: '夜的命名术', details: '会说话的肘子 · 笔趣阁中文', format: null }
  const local = initial ? aixia.filter(book => matchesBook(book, query)) : []
  const index = new Map<string, SourceBook>(!query && initial ? [[sample.id, sample]] : [])
  let warning: string | undefined
  let next: string | null = null
  try {
    const path = query ? '/search.html' : start || (category ? '/list/' + category + '_1/' : '/list/')
    const document = await documentFrom(new URL(path, BIQU), 'text/html', signal, query || undefined)
    if (query && !document.querySelector('.novel_so, .sort_list') && !/没有找到|没有搜索到|搜索结果/.test(document.body.textContent ?? '')) {
      throw new Error('书源没有返回搜索结果页。')
    }
    // 只取书名列，排除简介和搜索结果下方的推荐位。
    const links = document.querySelectorAll(query ? '.sort_list .s2 > a, .txt-list:not(.tag_news) .s2 > a' : '.s2 > a, dt > a')
    for (const link of links) {
      const id = link.getAttribute('href')?.match(/^\/book\/(\d{1,8})\/$/)?.[1]
      const title = link.textContent?.trim()
      if (!id || !title || index.has('bi-' + id)) continue
      const row = link.closest('li')
      const authorColumn = query ? row?.querySelector('.s3') ?? row?.querySelector('.s5')
        : row?.querySelector(link.closest('.sort_list') ? '.s4' : '.s5')
      const author = authorColumn?.textContent?.trim() || link.closest('dt')?.querySelector('span')?.textContent?.trim()
      index.set('bi-' + id, { id: 'bi-' + id, title, details: [author, '笔趣阁中文'].filter(Boolean).join(' · '), format: null })
    }
    if (!query) {
      if (!links.length) throw new Error('书源没有返回书目。')
      const href = findLink(document, '下一页')
      const match = href?.match(/^\/list\/([0-8])_(\d{1,6})\/$/)
      if (match && Number(match[1]) === category && href !== path) next = href ?? null
    }
  } catch (error) {
    signal.throwIfAborted()
    if (!initial || query && !local.length) throw error
    warning = '笔趣阁中文暂不可用，当前显示已收录书目。'
  }
  const known = new Set(local.map(book => book.title.normalize('NFKC')))
  return { books: [...local, ...[...index.values()].filter(book => !known.has(book.title.normalize('NFKC')))], next, warning }
}

export function sourceCatalog(source: Source, start: string, signal: AbortSignal, query: string, category: number): Promise<SourcePage> {
  if (source === 'western') {
    const books: SourceBook[] = editions.filter(book => matchesBook(book, query)).map(({ id, title, details }) => ({ id, title, details, format: 'epub' }))
    return Promise.resolve({ books, next: null })
  }
  return source === 'chinese' ? chineseCatalog(start, signal, query) : novelCatalog(start, signal, query, category)
}

async function ebookBytes(id: string) {
  const edition = editions.find(edition => edition.id === id)
  if (edition) {
    const url = new URL(WIKI_EXPORT)
    url.search = new URLSearchParams({ format: 'epub', lang: 'zh', page: edition.page }).toString()
    return receive(url)
  }
  const match = id.match(/^pg-(\d{1,8})$/)
  if (!match) throw new Error('找不到书籍。')
  const url = new URL('/ebooks/' + match[1] + '.opds', GUTENBERG)
  const document = await documentFrom(url, 'text/xml')
  const downloads = Array.from(document.getElementsByTagNameNS(ATOM, 'link')).filter(link =>
    link.getAttribute('type') === 'application/epub+zip' &&
    [ACQUISITION, ACQUISITION + '/open-access'].includes(link.getAttribute('rel') ?? ''))
  const href = (downloads.find(link => link.getAttribute('href')?.endsWith('.noimages')) ?? downloads[0])?.getAttribute('href')
  if (!href) throw new Error('这本书暂未提供 EPUB。')
  return receive(new URL(href, url))
}

// JSZip 的流式解压接口可在 WebView 内限制解压后的大小。
function unpack(entry: JSZip.JSZipObject, limit: number): Promise<ArrayBuffer> {
  const stream = (entry as JSZip.JSZipObject & {
    internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array<ArrayBuffer>>
  }).internalStream('uint8array')
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let size = 0
    stream.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        stream.pause()
        reject(new Error('书籍解压后超过大小限制。'))
      } else chunks.push(chunk)
    }).on('error', reject).on('end', () => {
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      resolve(bytes.buffer)
    }).resume()
  })
}

export async function sourceDownload(book: SourceBook) {
  const { default: zip } = await import('jszip')
  if (book.format === 'epub') {
    const bytes = await ebookBytes(book.id)
    const contents = await zip.loadAsync(bytes)
    const mime = contents.file('mimetype')
    if (!mime || !contents.file('META-INF/container.xml') ||
      new TextDecoder().decode(await unpack(mime, 32)) !== 'application/epub+zip') throw new Error('下载内容不是有效的 EPUB。')
    return new Blob([bytes], { type: 'application/epub+zip' })
  }
  if (book.format !== 'txt' || !aixia.some(item => item.id === book.id)) throw new Error('这本书暂未提供下载。')
  const archive = await zip.loadAsync(await receive(new URL(book.id.slice(3) + '_tw.zip', AIXIA + '/')))
  const files = Object.values(archive.files).filter(file => !file.dir && file.name.toLowerCase().endsWith('.txt'))
  if (files.length !== 1) throw new Error('下载包没有单本 TXT。')
  const text = decodeText(await unpack(files[0], SOURCE_FILE_LIMIT))
  if (!text.trim()) throw new Error('下载内容为空。')
  return new Blob([text], { type: 'text/plain; charset=utf-8' })
}

function novelBase(book: SourceBook) {
  const id = book.id.match(/^bi-(\d{1,8})$/)?.[1]
  if (!id) throw new Error('章节地址不可用。')
  return new URL('/book/' + id + '/', BIQU)
}

function novelPath(href: string | null | undefined, base: URL) {
  if (!href) return null
  try {
    const url = new URL(href, base)
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) && sourceRequestLimit(url)
      ? url.pathname.slice(base.pathname.length) : null
  } catch {
    return null
  }
}

function chapterPath(href: string | null | undefined, base: URL) {
  const name = novelPath(href, base)
  return name && /^\d{1,12}(?:_\d{1,4})?\.html$/.test(name) ? name : null
}

function findLink(document: Document, label: string) {
  return Array.from(document.links).find(link => link.textContent?.trim() === label)?.getAttribute('href')
}

export interface OnlineContents {
  entries: { title: string; cursor: string }[]
  next: string | null
}

export async function onlineContents(book: SourceBook, cursor: string, signal: AbortSignal): Promise<OnlineContents> {
  const base = novelBase(book)
  if (cursor && !/^ml\d{1,6}\.html$/.test(cursor)) throw new Error('目录地址不可用。')
  const document = await documentFrom(new URL(cursor, base), 'text/html', signal)
  // 详情页最后一组是从头排序的正文目录，前一组只展示最近更新。
  const section = Array.from(document.querySelectorAll('.chapter-list, .section-list')).at(-1)
  const entries = new Map<string, { title: string; cursor: string }>()
  for (const link of section?.querySelectorAll('a[href]') ?? []) {
    const path = chapterPath(link.getAttribute('href'), base)
    const title = link.textContent?.trim()
    if (!path || !title) continue
    const firstPage = path.replace(/_\d+\.html$/, '.html')
    if (!entries.has(firstPage)) entries.set(firstPage, { title, cursor: firstPage })
  }
  if (!entries.size) throw new Error('书源没有返回目录。')
  const path = novelPath(findLink(document, cursor ? '下一页' : '章节目录'), base)
  const next = path && path !== cursor && /^ml\d{1,6}\.html$/.test(path) ? path : null
  return { entries: [...entries.values()], next }
}

export async function onlineChapter(book: SourceBook, cursor: string, signal: AbortSignal): Promise<OnlineChapter> {
  const base = novelBase(book)
  const path = cursor ? chapterPath(cursor, base) : chapterPath(findLink(await documentFrom(base, 'text/html', signal), '开始阅读'), base)
  if (!path) throw new Error('书源暂未提供章节入口。')
  const document = await documentFrom(new URL(path, base), 'text/html', signal)
  const desktopContent = document.querySelector('.word_read')
  const content = desktopContent ?? document.querySelector('.content > .txt')
  if (!content) throw new Error('书源没有返回正文。')
  // 只解析网页中的段落数据，不执行页面脚本。
  const paragraphs = Array.from(content.querySelectorAll('script')).flatMap(script => {
    const encoded = script.textContent?.match(/^\s*document\.writeln\(qsbs\.bb\('([A-Za-z0-9+/=]+)'\)\);?\s*$/)?.[1]
    if (!encoded) return []
    const text = new TextDecoder().decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)))
    return Array.from(new DOMParser().parseFromString(text, 'text/html').querySelectorAll('p')).map(paragraph => paragraph.textContent?.trim()).filter(Boolean)
  })
  const direct = Array.from(content.children).filter(node => node.localName === 'p').map(node => node.textContent?.trim())
    .filter(text => text && !/^(?:请勿开启|相邻推荐[:：])/.test(text))
  const text = (paragraphs.length ? paragraphs : direct).join('\n\n')
  if (!text) throw new Error('书源没有返回正文。')
  // 手机版的翻页按钮通过脚本绑定，只读取已知的链接字面量，仍校验同站同书。
  const navigation = desktopContent ? '' : Array.from(document.scripts, script => script.textContent).join('\n')
  const previous = navigation.match(/\bvar\s+lkldeh\s*=\s*(['"])([^'"\r\n]+)\1/)?.[2]
  const next = navigation.match(/\bvar\s+hhekgsv\s*=\s*(['"])([^'"\r\n]+)\1/)?.[2]
  return {
    title: (desktopContent?.querySelector('h3') ?? content.parentElement?.querySelector('.chaptername'))?.textContent?.trim() || book.title,
    text,
    previous: chapterPath(findLink(document, '上一章'), base) ?? chapterPath(previous, base),
    next: chapterPath(findLink(document, '下一章'), base) ?? chapterPath(next, base)
  }
}
