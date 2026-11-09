import type { Mark, Position } from './model'

export interface BookData {
  category?: string
  position?: Position
  lastRead?: number
  marks?: Mark[]
}

export interface ReadingData {
  categories: string[]
  books: Record<string, BookData>
}

export function readData(): ReadingData {
  try {
    return JSON.parse(localStorage.getItem('reading-data') ?? '{"categories":[],"books":{}}') as ReadingData
  } catch {
    return { categories: [], books: {} }
  }
}

export function saveData(data: ReadingData) {
  localStorage.setItem('reading-data', JSON.stringify(data))
}

export function getCover(id: string): string | undefined {
  return localStorage.getItem('cover:' + id) ?? undefined
}

export function saveCover(id: string, cover: string) {
  try {
    // 封面可以重新提取，为笔记和阅读记录留出本地存储空间。
    const covers = Object.keys(localStorage).filter(key => key.startsWith('cover:'))
    if (covers.length >= 24 && !covers.includes('cover:' + id)) localStorage.removeItem(covers[0])
    localStorage.setItem('cover:' + id, cover)
  } catch (error) {
    console.warn('无法缓存书籍封面', error)
  }
}
