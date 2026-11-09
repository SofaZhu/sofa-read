import type { Desktop } from '../shared/desktop'

declare global {
  interface Window {
    desktop: Desktop
    queryLocalFonts?: () => Promise<{ family: string }[]>
  }
}

export { FORMATS, identifyFormat } from '../shared/book'
export type { Book } from '../shared/book'

export const THEMES = {
  paper: { name: '白纸黑字', bg: '#ffffff', fg: '#1b1b1b' },
  green: { name: '浅绿', bg: '#e5eedc', fg: '#253427' },
  yellow: { name: '浅黄', bg: '#f7edcc', fg: '#362c1e' },
  gray: { name: '浅灰', bg: '#e7e7e7', fg: '#292929' },
  dark: { name: '深色', bg: '#20241f', fg: '#e9e9df' }
}

export interface Settings {
  theme: keyof typeof THEMES
  background: string
  brightness: number
  size: number
  spacing: number
  font: string
  mode: 'scroll' | 'page'
  volume: boolean
  tap: boolean
  chapter: boolean
  battery: boolean
  clock: boolean
  idle: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'yellow', background: '', brightness: 100, size: 20, spacing: 1.8, font: 'serif',
  mode: 'page', volume: false, tap: true, chapter: true, battery: true, clock: true, idle: 0
}

export interface Chapter {
  label: string
  target: string | number
  children?: Chapter[]
}

export interface Position {
  target: string | number
  chapter: string
  page: number
  total: number
  estimated?: boolean
  fraction?: number
}

export interface Mark {
  id: string
  kind: 'bookmark' | 'note'
  position: Position
  text: string
}

export function readSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('settings') ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}
