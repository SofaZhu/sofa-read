import { contextBridge, ipcRenderer } from 'electron'
import type { Desktop } from '../shared/desktop'

const desktop: Desktop = {
  fetchSource: (url, query) => ipcRenderer.invoke('sources:fetch', url, query),
  listBooks: () => ipcRenderer.invoke('library:list'),
  importBooks: () => ipcRenderer.invoke('library:import'),
  readBook: id => ipcRenderer.invoke('library:read', id),
  relinkBook: id => ipcRenderer.invoke('library:relink', id),
  removeBook: id => ipcRenderer.invoke('library:remove', id),
  setReading: (active, minutes, volume) => ipcRenderer.invoke('reading:settings', active, minutes, volume),
  onTurn(callback) {
    const listener = (_event: unknown, step: number) => callback(step)
    ipcRenderer.on('reading:turn', listener)
    return () => ipcRenderer.removeListener('reading:turn', listener)
  },
  onDim(callback) {
    const listener = (_event: unknown, dim: boolean) => callback(dim)
    ipcRenderer.on('reading:dim', listener)
    return () => ipcRenderer.removeListener('reading:dim', listener)
  }
}
contextBridge.exposeInMainWorld('desktop', desktop)
