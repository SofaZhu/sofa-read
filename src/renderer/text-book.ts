const heading = /^(?:第[\d零〇一二三四五六七八九十百千万两]+[卷章节回部篇](?:.{0,60})|(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+)\b.{0,60}|#{1,4}\s+.{1,70}|序章|序言|楔子|前言|后记|尾声)$/i

export function decodeText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gb18030').decode(buffer)
  }
}

export function splitChapters(text: string) {
  const sections: { label: string; lines: string[] }[] = []
  let current: typeof sections[number] = { label: '正文', lines: [] }
  const flush = () => {
    if (current.lines.some(line => line.trim())) sections.push(current)
  }
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim()
    if (heading.test(line)) {
      flush()
      current = { label: line.replace(/^#{1,4}\s+/, ''), lines: [line.replace(/^#{1,4}\s+/, '')] }
    } else {
      // 给无目录的长文本分段，避免一次排版整本书。
      if (current.lines.length >= 350) {
        flush()
        current = { label: `正文 · ${sections.length + 1}`, lines: [] }
      }
      current.lines.push(raw)
    }
  }
  flush()
  return sections
}

export function makeTextBook(text: string) {
  const sections = splitChapters(text)
  const urls = new Map<number, string>()
  const escape = (line: string) => line.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!)
  return {
    sections: sections.map(({ lines }, index) => ({
      id: index,
      size: new TextEncoder().encode(lines.join('\n')).length,
      load() {
        if (!urls.has(index)) {
          const body = lines.map(line => line.trim() ? `<p>${escape(line)}</p>` : '<p><br></p>').join('')
          urls.set(index, URL.createObjectURL(new Blob([`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>${body}</body></html>`], { type: 'text/html' })))
        }
        return urls.get(index)!
      }
    })),
    toc: sections.map(({ label }, index) => ({ label, href: String(index) })),
    resolveHref: (href: string) => ({ index: Number(href) }),
    splitTOCHref: (href: string) => [Number(href)],
    getTOCFragment: () => null,
    destroy() {
      for (const url of urls.values()) URL.revokeObjectURL(url)
    }
  }
}
