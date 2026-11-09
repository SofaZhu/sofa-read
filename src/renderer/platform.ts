import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { identifyFormat, type Book } from '../shared/book'
import type { Desktop } from '../shared/desktop'

interface DocumentReference {
  name: string
  bytes: number
  reference: string
  identity: string
}

interface MobileBook extends Book {
  document: DocumentReference
}

interface SofaNative {
  pick(options: { multiple: boolean }): Promise<{ documents: DocumentReference[] }>
  open(options: { reference: string }): Promise<{ token: string }>
  chunk(options: { token: string }): Promise<{ data: string; done: boolean }>
  close(options: { token: string }): Promise<void>
  release(options: { reference: string }): Promise<void>
  reading(options: { active: boolean; awake: boolean; volume: boolean }): Promise<{ volume: boolean }>
  fonts(): Promise<{ families: string[] }>
  addListener(name: 'back', callback: (event: { method: 'click' | 'swipe' }) => void): Promise<PluginListenerHandle>
  addListener(name: 'turn', callback: (event: { step: number }) => void): Promise<PluginListenerHandle>
}

const native = registerPlugin<SofaNative>('SofaNative')
export const mobile = Capacitor.isNativePlatform()
export const supportsVolumeKeys = Capacitor.getPlatform() !== 'ios'
const key = 'mobile-library'
const getBooks = (): MobileBook[] => JSON.parse(localStorage.getItem(key) ?? '[]')
const setBooks = (books: MobileBook[]) => localStorage.setItem(key, JSON.stringify(books))
const summary = ({ id, name, format, bytes, added }: MobileBook): Book => ({ id, name, format, bytes, added })

export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function release(document: DocumentReference) {
  try {
    await native.release({ reference: document.reference })
  } catch (error) {
    console.debug('无法释放文件访问权限', error)
  }
}

function mobilePlatform(): Desktop {
  let dimCallback: ((dim: boolean) => void) | undefined
  let inactivity: ReturnType<typeof setTimeout> | undefined
  let config = { active: false, minutes: 0, volume: false }
  let dimmed = false

  async function apply() {
    const awake = config.active && !dimmed && !document.hidden
    return (await native.reading({ active: config.active, awake, volume: awake && config.volume })).volume
  }

  function reportDim(value: boolean) {
    dimmed = value
    dimCallback?.(value)
  }

  function resetTimer() {
    clearTimeout(inactivity)
    if (!config.active || document.hidden || !config.minutes) return
    inactivity = setTimeout(() => {
      reportDim(true)
      void apply().catch(error => console.warn('无法更新移动端常亮状态', error))
    }, config.minutes * 60_000)
  }

  function activity() {
    if (dimmed) {
      reportDim(false)
      void apply().catch(error => console.warn('无法恢复移动端常亮状态', error))
    }
    resetTimer()
  }

  window.addEventListener('pointerdown', activity, { passive: true })
  window.addEventListener('keydown', activity)
  document.addEventListener('visibilitychange', () => {
    reportDim(false)
    resetTimer()
    void apply().catch(error => console.warn('无法同步移动端常亮状态', error))
  })

  return {
    async listBooks() {
      return getBooks().map(summary)
    },
    async importBooks() {
      const { documents } = await native.pick({ multiple: true })
      if (!documents.length) return []
      const books = getBooks()
      const added: MobileBook[] = []
      const rejected: DocumentReference[] = []
      for (const document of documents) {
        if ([...books, ...added].some(book => book.document.identity === document.identity)) continue
        const format = identifyFormat(document.name)
        if (!format) {
          rejected.push(document)
          continue
        }
        added.push({
          id: newId(), name: document.name.slice(0, -format.length - 1),
          format, bytes: document.bytes, added: Date.now(), document
        })
      }
      setBooks([...books, ...added])
      await Promise.all(rejected.map(release))
      if (rejected.length && !added.length) throw new Error('未选择可识别的书籍。')
      return added.map(summary)
    },
    async readBook(id, signal) {
      const book = getBooks().find(entry => entry.id === id)
      if (!book) return null
      let token: string | undefined
      try {
        if (signal?.aborted) return null
        if (Capacitor.getPlatform() === 'android' && book.document.reference.startsWith('content://')) {
          // 系统 WebView 可以直接读取 SAF 授权的原文件，避免逐块跨桥传输。
          const url = Capacitor.convertFileSrc(book.document.reference)
          if (url !== book.document.reference) {
            try {
              const response = await fetch(url, { signal })
              if (response.ok) {
                const blob = await response.blob()
                if (blob.size) return blob
              }
            } catch (error) {
              if (signal?.aborted) return null
              console.debug('直接读取不可用，使用文件提供方读取', error)
            }
          }
        }
        token = (await native.open({ reference: book.document.reference })).token
        const chunks: Uint8Array<ArrayBuffer>[] = []
        while (!signal?.aborted) {
          const { data, done } = await native.chunk({ token })
          if (data) {
            const raw = atob(data)
            const decoded = new Uint8Array(raw.length)
            for (let index = 0; index < raw.length; index++) decoded[index] = raw.charCodeAt(index)
            chunks.push(decoded)
          }
          if (done) return new Blob(chunks)
        }
        return null
      } catch (error) {
        console.debug('无法打开移动端原文件', error)
        return null
      } finally {
        if (token) await native.close({ token }).catch(error => console.debug('无法关闭文件流', error))
      }
    },
    async relinkBook(id) {
      const { documents: [document] } = await native.pick({ multiple: false })
      if (!document) return null
      const books = getBooks()
      const book = books.find(entry => entry.id === id)
      const sameFile = books.some(entry => entry.id !== id && entry.document.identity === document.identity)
      if (!book || identifyFormat(document.name) !== book.format || sameFile) {
        if (!sameFile && !books.some(entry => entry.document.identity === document.identity)) await release(document)
        throw new Error('请选择与原书格式相同的其他文件。')
      }
      const next = { ...book, document, bytes: document.bytes }
      setBooks(books.map(entry => entry.id === id ? next : entry))
      if (book.document.identity !== document.identity) await release(book.document)
      return summary(next)
    },
    async removeBook(id) {
      const books = getBooks()
      const book = books.find(entry => entry.id === id)
      setBooks(books.filter(entry => entry.id !== id))
      if (book) await release(book.document)
    },
    async setReading(active, minutes, volume) {
      config = { active, minutes, volume }
      reportDim(false)
      resetTimer()
      return apply()
    },
    onTurn(callback) {
      if (!supportsVolumeKeys) return () => {}
      const handle = native.addListener('turn', event => {
        activity()
        callback(event.step)
      }).catch(error => {
        console.warn('无法监听移动端音量键', error)
      })
      return () => { void handle.then(value => value?.remove()).catch(error => console.debug('无法清理音量键监听', error)) }
    },
    onBack(callback) {
      if (Capacitor.getPlatform() !== 'android') return () => {}
      const handle = native.addListener('back', event => callback(event.method)).catch(error => {
        console.warn('无法监听系统返回', error)
      })
      return () => { void handle.then(value => value?.remove()).catch(error => console.debug('无法清理系统返回监听', error)) }
    },
    onDim(callback) {
      dimCallback = callback
      return () => { dimCallback = undefined }
    },
    activity
  }
}

export const platform = mobile ? mobilePlatform() : window.desktop

export async function listFonts(): Promise<string[]> {
  if (mobile) return (await native.fonts()).families
  return (await window.queryLocalFonts?.() ?? []).map(font => font.family)
}

export async function mobileBattery() {
  if (!mobile) return null
  const result = await Device.getBatteryInfo()
  return typeof result.batteryLevel === 'number' && result.batteryLevel >= 0
    ? { level: result.batteryLevel, charging: result.isCharging }
    : null
}
