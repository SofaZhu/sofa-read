import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { FORMATS, identifyFormat, type Book } from '../shared/book'

interface LocalBook extends Book {
  path: string
}

const metadata = ({ id, name, format, bytes, added }: LocalBook): Book => ({ id, name, format, bytes, added })

export function registerLibrary(getWindow: () => BrowserWindow | null) {
  const path = join(app.getPath('userData'), 'library.json')
  let books: LocalBook[] = []
  try {
    books = JSON.parse(readFileSync(path, 'utf8')) as LocalBook[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  function save(next: LocalBook[]) {
    writeFileSync(path + '.tmp', JSON.stringify(next), 'utf8')
    renameSync(path + '.tmp', path)
    books = next
  }

  function handle<T>(channel: string, operation: (id: string) => T) {
    ipcMain.handle('library:' + channel, (event, value: unknown) => {
      const window = getWindow()
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('无法访问本地书架。')
      }
      return operation(typeof value === 'string' ? value : '')
    })
  }

  async function choose(window: BrowserWindow, multiple: boolean) {
    return dialog.showOpenDialog(window, {
      title: multiple ? '导入本机书籍' : '重新定位原文件',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: '电子书', extensions: [...FORMATS.filter(value => value !== 'fb2.zip'), 'zip'] }]
    })
  }

  handle('list', () => books.map(metadata))
  handle('import', async () => {
    const window = getWindow()
    if (!window) return []
    const result = await choose(window, true)
    if (result.canceled) return []
    const selected = result.filePaths.map(path => {
      const existing = books.find(book => book.path === path)
      if (existing) return existing
      const name = basename(path)
      const format = identifyFormat(name)
      const stat = statSync(path)
      if (!format || !stat.isFile() || !stat.size) throw new Error('文件为空或格式不受支持。')
      return { id: randomUUID(), name: name.slice(0, -format.length - 1), path, format, bytes: stat.size, added: Date.now() }
    })
    const added = selected.filter(book => !books.some(current => current.id === book.id))
    if (added.length) save([...books, ...added])
    return selected.map(metadata)
  })
  handle('read', async id => {
    const book = books.find(book => book.id === id)
    if (!book) return null
    try {
      return await readFile(book.path)
    } catch (error) {
      console.warn('无法读取书籍原文件', error)
      return null
    }
  })
  handle('relink', async id => {
    const window = getWindow()
    const book = books.find(book => book.id === id)
    if (!window || !book) return null
    const result = await choose(window, false)
    if (result.canceled) return null
    const path = result.filePaths[0]
    const current = books.find(entry => entry.id === id)
    if (!current) return null
    const stat = statSync(path)
    if (identifyFormat(path) !== current.format || !stat.isFile() || !stat.size) {
      throw new Error('请选择与原书籍格式相同的非空文件。')
    }
    const next = { ...current, path, bytes: stat.size }
    save(books.map(entry => entry.id === id ? next : entry))
    return metadata(next)
  })
  handle('remove', id => {
    if (books.some(book => book.id === id)) save(books.filter(book => book.id !== id))
  })
}
