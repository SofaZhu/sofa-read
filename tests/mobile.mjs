import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve('out/renderer')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname)
    if (!path.startsWith(root + sep)) throw new Error('无效的资源路径')
    const body = await readFile(path)
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.SOFA_TEST_CHROME })
  for (const system of ['ios', 'android']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors = []
    page.on('pageerror', error => errors.push(error))
    await page.addInitScript(system => {
      window.CapacitorCustomPlatform = { name: system }
      const methods = list => list.map(name => ({ name, rtype: 'promise' }))
      const document = { name: '手机测试.txt', bytes: 50, reference: '原文件引用', identity: '原文件标识' }
      window.Capacitor = {
        PluginHeaders: [
          { name: 'SofaNative', methods: [...methods(['pick', 'open', 'chunk', 'close', 'release', 'reading', 'fonts']), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }] },
          { name: 'Device', methods: methods(['getBatteryInfo']) }
        ],
        async nativePromise(_plugin, method) {
          const cases = {
            pick: { documents: [document] },
            open: { token: '文件流' },
            chunk: { data: btoa(String.fromCharCode(...new TextEncoder().encode('第一章 出发\n手机测试。\n第二章 返回\n仍可继续。'))), done: true },
            reading: { volume: system === 'android' },
            fonts: { families: ['测试系统字体'] },
            getBatteryInfo: { batteryLevel: .65, isCharging: false }
          }
          return cases[method]
        },
        nativeCallback() { return '测试监听' }
      }
    }, system)
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`)
    await page.getByRole('button', { name: '＋ 导入书籍' }).tap()
    await page.locator('.open-card').tap()
    await page.locator('.chapter-line').getByText('第一章 出发').waitFor()
    await page.getByText('电量 65%').waitFor()
    await page.getByRole('button', { name: '设置', exact: true }).tap()
    assert.equal(await page.getByLabel('音量键翻页').count(), system === 'ios' ? 0 : 1)
    await page.getByRole('button', { name: '载入本机字体' }).tap()
    await page.getByText('已载入本机字体').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('移动界面冒烟通过：触屏导入、手机宽度、电量、本机字体和平台设置可见性。')
} finally {
  await browser?.close()
  server.close()
}
