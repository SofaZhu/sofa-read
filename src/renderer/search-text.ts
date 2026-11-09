export const SEARCH_QUERY_LIMIT = 20

const EXCERPT_LENGTH = 50

export function limitSearchQuery(query: string) {
  return Array.from(query).slice(0, SEARCH_QUERY_LIMIT).join('')
}

export function searchExcerpt(text: string, start: number, length: number) {
  const before = Array.from(text.slice(Math.max(0, start - 40), start)).slice(-15).join('').trimStart()
  const match = text.slice(start, start + length)
  const remaining = EXCERPT_LENGTH - Array.from(before + match).length
  const after = Array.from(text.slice(start + length, start + length + remaining * 2))
    .slice(0, remaining).join('').trimEnd()
  return { before, match, after }
}
