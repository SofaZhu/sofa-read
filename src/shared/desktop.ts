import type { Book } from './book'

export interface Desktop {
  fetchSource?(url: string, query?: string): Promise<Uint8Array<ArrayBuffer>>
  listBooks(): Promise<Book[]>
  importBooks(): Promise<Book[]>
  readBook(id: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | Blob | null>
  relinkBook(id: string): Promise<Book | null>
  removeBook(id: string): Promise<void>
  setReading(active: boolean, minutes: number, volume: boolean): Promise<boolean>
  onTurn(callback: (step: number) => void): () => void
  onBack?(callback: (method: 'click' | 'swipe') => void): () => void
  activity?(): void
  onDim(callback: (dim: boolean) => void): () => void
}
