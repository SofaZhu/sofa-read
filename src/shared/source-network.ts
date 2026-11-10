export const SOURCE_TEXT_LIMIT = 2_000_000
export const SOURCE_FILE_LIMIT = 30_000_000

const WIKI_EDITIONS = new Set(['巴黎茶花女遺事', '伊索寓言_(林紓)', '莎士比亞戲劇全集_(朱生豪)/仲夏夜之夢'])
const NOVEL_ARCHIVES = new Set(['/501204_tw.zip', '/200792_tw.zip'])

export const SOURCE_QUERY_LIMIT = 60
export const SOURCE_FORM_TYPE = 'application/x-www-form-urlencoded'

export function sourceRequestLimit(url: URL, query?: string): number {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return 0
  const { hostname, pathname, search, searchParams } = url
  if (query !== undefined) {
    return hostname === 'www.xwbqgzw.com' && pathname === '/search.html' && !search &&
      query.trim().length > 0 && query.length <= SOURCE_QUERY_LIMIT ? SOURCE_TEXT_LIMIT : 0
  }
  if (hostname === 'www.gutenberg.org') {
    if (pathname === '/ebooks/search.opds/' && /^l\.zh(?: [^\r\n]{1,60})?$/.test(searchParams.get('query') ?? '') &&
      searchParams.getAll('query').length === 1 && searchParams.getAll('start_index').length <= 1 &&
      /^\d{0,6}$/.test(searchParams.get('start_index') ?? '') &&
      [...searchParams.keys()].every(key => key === 'query' || key === 'start_index')) return SOURCE_TEXT_LIMIT
    if (!search && /^\/ebooks\/\d{1,8}\.opds$/.test(pathname)) return SOURCE_TEXT_LIMIT
    if (!search && /^\/(?:ebooks\/\d{1,8}\.epub(?:3)?\.(?:images|noimages)|cache\/epub\/\d{1,8}\/pg\d{1,8}(?:-images(?:-3)?)?\.epub)$/.test(pathname)) return SOURCE_FILE_LIMIT
  }
  if (hostname === 'ws-export.wmcloud.org' && pathname === '/' && searchParams.get('format') === 'epub' &&
    searchParams.get('lang') === 'zh' && WIKI_EDITIONS.has(searchParams.get('page') ?? '') &&
    [...searchParams].length === 3) return SOURCE_FILE_LIMIT
  if (hostname === 'www.xwbqgzw.com' && !search) {
    if (/^\/(?:book\/\d{1,8}\/(?:(?:\d{1,12}(?:_\d{1,4})?|ml\d{1,6})\.html)?)?$/.test(pathname) ||
      /^\/list\/(?:[0-8]_\d{1,6}\/)?$/.test(pathname)) return SOURCE_TEXT_LIMIT
  }
  if (hostname === 'down7.ixdzs8.tw' && !search && NOVEL_ARCHIVES.has(pathname)) return SOURCE_FILE_LIMIT
  return 0
}

// 同一目录有两种页面结构，统一取手机版以避开桌面页附带的推荐章节。
export function sourceHeaders(url: URL, query?: string): Record<string, string> {
  if (query !== undefined) return { 'Content-Type': SOURCE_FORM_TYPE }
  if (url.hostname === 'www.xwbqgzw.com' && /\/ml\d+\.html$/.test(url.pathname)) {
    return { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' }
  }
  return {}
}
