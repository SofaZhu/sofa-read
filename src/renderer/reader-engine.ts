import type { Chapter, Position, Settings } from './model'

export interface ReaderEvents {
  position(position: Position): void
  chapters(chapters: Chapter[]): void
  cover?(data: string): void
  activity?(): void
  key(event: KeyboardEvent): void
  tap(event: MouseEvent, width: number): void
}

export interface ReaderEngine {
  open(file: File, start: Position | null): Promise<void>
  go(target: Position['target']): Promise<void>
  step(direction: number): Promise<void>
  configure(settings: Settings): void
  close(): void
}
