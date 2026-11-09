import type { Chapter, Position, Settings } from './model'

export interface ReaderEvents {
  position(position: Position): void
  chapters(chapters: Chapter[]): void
  cover?(data: string): void
  activity?(): void
  key(event: KeyboardEvent): void
  tap(ratio: number): void
  back(): void
}

export interface SearchMatch {
  target: Position['target']
  excerpt: string
}

export interface ReaderEngine {
  open(file: File, start: Position | null): Promise<void>
  go(target: Position['target']): Promise<void>
  seek(fraction: number): Promise<void>
  search(query: string, signal: AbortSignal): AsyncGenerator<SearchMatch>
  step(direction: number): Promise<void>
  configure(settings: Settings): void
  close(): void
}
