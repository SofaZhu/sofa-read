import { ipcMain, type BrowserWindow } from 'electron'
import { sourceHeaders, sourceRequestLimit } from '../shared/source-network'

export function registerSourceNetwork(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('sources:fetch', async (event, input: unknown, query: unknown) => {
    const window = getWindow()
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      typeof input !== 'string' || input.length > 2048 || (query !== undefined && typeof query !== 'string')) throw new Error('无法访问书源。')

    let url = new URL(input)
    const signal = AbortSignal.timeout(45_000)
    for (let hop = 0; hop < 5; hop++) {
      const limit = sourceRequestLimit(url, query)
      if (!limit) throw new Error('书源地址不可用。')
      const response = await fetch(url, {
        redirect: 'manual', signal, headers: sourceHeaders(url, query),
        ...(query === undefined ? {} : { method: 'POST', body: new URLSearchParams({ s: query }) })
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        const next = response.headers.get('location')
        if (!next || query !== undefined) break
        url = new URL(next, url)
        continue
      }
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel()
        throw new Error('书源没有返回可用内容。')
      }
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > limit) throw new Error('书源文件超过大小限制。')
        chunks.push(chunk)
      }
      return Buffer.concat(chunks, size)
    }
    throw new Error('书源跳转失败。')
  })
}
