import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright-core'
import JSZip from 'jszip'

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
const archive = new JSZip()
archive.file('折下.txt', '第一章 网文\n离线测试正文。')
const networkBook = await archive.generateAsync({ type: 'base64' })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.SOFA_TEST_CHROME })
  for (const system of ['ios', 'android']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors = []
    page.on('pageerror', error => errors.push(error))
    await page.addInitScript(({ system, networkBook }) => {
      window.CapacitorCustomPlatform = { name: system }
      const methods = list => list.map(name => ({ name, rtype: 'promise' }))
      const callbacks = new Map()
      const document = { name: '手机测试.txt', bytes: 50, reference: '原文件引用', identity: '原文件标识' }
      window.Capacitor = {
        PluginHeaders: [
          { name: 'SofaNative', methods: [...methods(['pick', 'open', 'chunk', 'close', 'release', 'reading', 'fonts']), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }] },
          { name: 'Device', methods: methods(['getBatteryInfo']) },
          { name: 'CapacitorHttp', methods: methods(['request']) }
        ],
        async nativePromise(plugin, method, options) {
          if (plugin === 'CapacitorHttp') {
            const url = new URL(options.url)
            if (!options.disableRedirects || options.responseType !== 'arraybuffer') throw new Error('网络参数不匹配。')
            if (url.hostname === 'www.xwbqgzw.com') {
              const encode = text => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
              const mobileChapter = (title, text, next, previous) =>
                `<div class="content"><h1 class="chaptername">${title}</h1>
                  <script>var hhekgsv='${next}';var lkldeh='${previous}';</script>
                  <div class="txt"><script>document.writeln(qsbs.bb('${encode('<p>' + text + '</p>')}'));</script></div>
                </div>`
              const bookRows = (start, count) => Array.from({ length: count }, (_, index) =>
                `<li><span class="s2"><a href="/book/${start + index}/">网文 ${start + index}</a></span></li>`).join('')
              if (url.pathname === '/search.html') {
                if (options.method !== 'POST' || options.data?.s !== '会说话的肘子') throw new Error('搜索参数不匹配。')
                const html = '<ul class="sort_list"><li><span class="s2"><a href="/book/766/">夜的命名术</a></span><span class="s5">会说话的肘子</span></li></ul>'
                return { status: 200, headers: {}, data: encode(html), url: url.href }
              }
              const pages = {
                '/list/': '<ul class="sort_list">' + bookRows(1000, 23) + '</ul><a href="/list/0_2/">下一页</a>',
                '/list/0_2/': '<ul class="sort_list">' + bookRows(2000, 22) + '</ul>',
                '/book/766/': '<a href="/book/766/613732.html">开始阅读</a><ul class="chapter-list"><li><a href="/book/766/613732.html">第一章</a></li></ul><a href="/book/766/ml1.html">章节目录</a>',
                '/book/766/ml1.html': '<ul class="chapter-list"><li><a href="/book/766/613732_1.html">第一章副页</a></li><li><a href="/book/766/613733.html">第二章</a></li></ul>',
                '/book/766/613733.html': mobileChapter('第二章', '从在线目录跳转。', '/book/766/', '/book/766/613732_1.html'),
                '/book/766/613732.html': mobileChapter('第一章（第1页）', '手机版章节正文。', '/book/766/613732_1.html', '/book/766/'),
                '/book/766/613732_1.html': mobileChapter('第一章（第2页）', '手机版下一页正文。', '/book/999/1.html', '/book/766/613732.html')
              }
              const html = pages[url.pathname]
              return { status: html ? 200 : 404, headers: {}, data: encode(html ?? ''), url: url.href }
            }
            if (url.href === 'https://down7.ixdzs8.tw/501204_tw.zip') {
              return { status: 200, headers: {}, data: networkBook, url: url.href }
            }
            return { status: 404, headers: {}, data: '', url: url.href }
          }
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
        nativeCallback(_plugin, method, options, callback) {
          if (method === 'addListener') callbacks.set(options.eventName, callback)
          if (method === 'removeListener') callbacks.delete(options.eventName)
          return '测试监听'
        }
      }
      window.testNativeBack = () => callbacks.get('back')?.({ method: 'swipe' })
    }, { system, networkBook })
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`)
    await page.getByRole('button', { name: '＋ 导入书籍' }).tap()
    await page.locator('.open-card').tap()
    await page.locator('.chapter-line').getByText('第一章 出发').waitFor()
    await page.getByText('电量 65%').waitFor()
    await page.touchscreen.tap(195, 420)
    await page.getByRole('button', { name: '设置', exact: true }).tap()
    await page.getByRole('button', { name: '更多设置' }).tap()
    assert.equal(await page.getByLabel('音量键翻页').count(), system === 'ios' ? 0 : 1)
    await page.getByRole('button', { name: '阅读', exact: true }).tap()
    await page.touchscreen.tap(195, 420)
    await page.getByRole('button', { name: '设置', exact: true }).tap()
    await page.getByRole('button', { name: '载入本机字体' }).tap()
    await page.getByText('已载入本机字体').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    if (process.env.SOFA_TEST_MOBILE_SCREENSHOT && system === 'ios') {
      await page.screenshot({ path: process.env.SOFA_TEST_MOBILE_SCREENSHOT })
    }
    await page.getByRole('button', { name: '关闭面板' }).tap()
    await page.touchscreen.tap(195, 420)
    await page.getByRole('button', { name: '全文搜索', exact: true }).tap()
    const searchPage = page.getByRole('complementary', { name: '全文搜索' })
    assert.equal((await searchPage.boundingBox()).height, 844)
    await searchPage.getByLabel('搜索关键词').fill('手机测试')
    await searchPage.getByRole('button', { name: '搜索', exact: true }).tap()
    await searchPage.getByText('找到 1 条匹配').waitFor()
    assert.equal(await searchPage.locator('mark').textContent(), '手机测试')
    await searchPage.getByRole('button', { name: '返回阅读页' }).tap()
    async function swipeBack() {
      if (system === 'android') return page.evaluate(() => window.testNativeBack())
      const frame = page.frames().find(frame => frame.url().startsWith('blob:'))
      assert.ok(frame)
      await frame.evaluate(() => {
        setTimeout(() => {
          const target = document.body
          const touch = clientX => new Touch({ identifier: 1, target, clientX, clientY: 150 })
          target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(5)] }))
          target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [touch(105)] }))
        }, 20)
      })
    }
    await swipeBack()
    await page.getByText('再次滑动返回', { exact: false }).waitFor()
    await page.waitForTimeout(140)
    await swipeBack()
    await page.getByRole('heading', { name: '阅读记录', exact: true }).waitFor()
    await page.getByRole('button', { name: '网络导入', exact: true }).tap()
    await page.getByLabel('网址').fill('www.4396778.sy')
    await page.getByRole('dialog').getByRole('button', { name: '继续', exact: true }).tap()
    await page.waitForFunction(() => document.querySelectorAll('.source-book').length === 20)
    await page.getByRole('button', { name: '加载更多' }).scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelectorAll('.source-book').length === 40)
    await page.locator('.source-book').getByRole('heading', { name: '网文 2000', exact: true }).waitFor()
    await page.getByLabel('书名或作者').fill('会说话的肘子')
    await page.getByRole('button', { name: '搜索书源', exact: true }).tap()
    await page.locator('.source-book').getByRole('heading', { name: '夜的命名术', exact: true }).waitFor()
    assert.equal(await page.locator('.source-book').count(), 1)
    await page.locator('.source-book').filter({ hasText: '夜的命名术' }).getByRole('button', { name: '阅读', exact: true }).tap()
    const serial = page.getByRole('article', { name: '在线阅读' })
    await serial.getByText('手机版章节正文。').waitFor({ timeout: 3000 })
    assert.equal(await serial.getByRole('button', { name: '上一节' }).isDisabled(), true)
    await serial.getByRole('button', { name: '下一节' }).tap()
    await serial.getByText('手机版下一页正文。').waitFor()
    assert.equal(await serial.getByRole('button', { name: '下一节' }).isDisabled(), true)
    await serial.getByRole('button', { name: '上一节' }).tap()
    await serial.getByText('手机版章节正文。').waitFor()
    await serial.getByRole('button', { name: '目录', exact: true }).tap()
    const contents = page.getByRole('region', { name: '在线目录' })
    await contents.getByRole('button', { name: '第一章', exact: true }).waitFor()
    await contents.getByRole('button', { name: '加载更多章节' }).tap()
    await contents.getByRole('button', { name: '第二章', exact: true }).waitFor()
    assert.equal(await contents.getByRole('button', { name: '第一章副页' }).count(), 0)
    await contents.getByRole('button', { name: '第二章', exact: true }).tap()
    await serial.getByText('从在线目录跳转。').waitFor()
    await serial.getByRole('button', { name: '返回书源' }).tap()
    await page.getByRole('button', { name: '清除搜索' }).tap()
    const novel = page.locator('.source-book').filter({ hasText: '折下' })
    await novel.getByRole('button', { name: '下载', exact: true }).tap()
    await novel.getByRole('button', { name: '已下载', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.reload()
    await page.getByRole('button', { name: '书架', exact: true }).tap()
    await page.locator('.open-card').filter({ hasText: '折下' }).tap()
    await page.locator('.chapter-line').getByText('第一章 网文').waitFor()
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('移动界面冒烟通过：触屏导入、手机宽度、电量、本机字体、全屏搜索、平台设置可见性、二次滑动返回、在线目录、自动续载、书源搜索和离线阅读。')
} finally {
  await browser?.close()
  server.close()
}
