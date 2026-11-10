import type { Book } from '../shared/book'

const DATABASE = 'sofa-read-downloads'
const DOWNLOAD_PREFIX = 'download:'
const METADATA = 'books'
const CONTENT = 'content'

export function downloadId(sourceId: string) {
  return DOWNLOAD_PREFIX + sourceId
}

export function isDownload(id: string) {
  return id.startsWith(DOWNLOAD_PREFIX)
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function database() {
  const request = indexedDB.open(DATABASE, 1)
  request.onupgradeneeded = () => {
    request.result.createObjectStore(METADATA, { keyPath: 'id' })
    request.result.createObjectStore(CONTENT)
  }
  return requestResult(request)
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => T | Promise<T>) {
  const db = await database()
  try {
    const tx = db.transaction(stores, mode)
    const complete = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('本地书库操作已取消。'))
    })
    try {
      const [result] = await Promise.all([operation(tx), complete])
      return result
    } catch (error) {
      try { tx.abort() } catch { /* 事务可能已经回滚。 */ }
      throw error
    }
  } finally {
    db.close()
  }
}

export function listDownloads(): Promise<Book[]> {
  return transaction([METADATA], 'readonly', tx => requestResult(tx.objectStore(METADATA).getAll()))
}

export function readDownload(id: string): Promise<Blob | undefined> {
  return transaction([CONTENT], 'readonly', tx => requestResult(tx.objectStore(CONTENT).get(id)))
}

export function saveDownload(book: Book, content: Blob) {
  return transaction([METADATA, CONTENT], 'readwrite', tx => {
    tx.objectStore(METADATA).put(book)
    tx.objectStore(CONTENT).put(content, book.id)
  })
}

export function removeDownload(id: string) {
  return transaction([METADATA, CONTENT], 'readwrite', tx => {
    tx.objectStore(METADATA).delete(id)
    tx.objectStore(CONTENT).delete(id)
  })
}
