import type { searchExcerpt } from './search-text'
import type { Chapter, Position, Settings } from './model'

export interface ReaderEvents {
  position(position: Position): void
  chapters(chapters: Chapter[]): void
  cover?(data: string): void
  activity?(): void
  key(event: KeyboardEvent): void
  tap(ratio: number): void
  scroll(): void
  back(): void
}

export interface SearchMatch {
  target: Position['target']
  excerpt: ReturnType<typeof searchExcerpt>
}

export interface ReaderEngine {
  open(file: File, start: Position | null): Promise<void>
  go(target: Position['target']): Promise<void>
  isVisible?(target: Position['target']): boolean
  seek(fraction: number): Promise<void>
  search(query: string, signal: AbortSignal): AsyncGenerator<SearchMatch>
  step(direction: number): Promise<void>
  configure(settings: Settings): void
  close(): void
}
