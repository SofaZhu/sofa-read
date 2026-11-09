export const SEARCH_QUERY_LIMIT = 20

const EXCERPT_LENGTH = 50

export function limitSearchQuery(query: string) {
  return Array.from(query).slice(0, SEARCH_QUERY_LIMIT).join('')
}

export function searchExcerpt(text: string, match: number) {
  const before = Array.from(text.slice(Math.max(0, match - 40), match)).slice(-15)
  const after = Array.from(text.slice(match, match + EXCERPT_LENGTH * 2))
  return [...before, ...after].slice(0, EXCERPT_LENGTH).join('').trim()
}
