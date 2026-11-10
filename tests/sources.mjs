import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import JSZip from 'jszip'

const profile = await mkdtemp(join(tmpdir(), 'sofa-read-sources-'))
const archive = new JSZip()
archive.file('折下.txt', '第一章 相遇\n网络书源下载测试。\n第二章 重逢\n仍能离线阅读。')
const fixture = await archive.generateAsync({ type: 'base64' })
let app

try {
  app = await electron.launch({ executablePath: electronPath, args: ['tests/launch-electron.cjs'], env: { ...process.env, SOFA_TEST_PROFILE: profile } })
  if (!process.env.SOFA_TEST_LIVE_SOURCES) {
    await app.evaluate((_, zip) => {
      globalThis.fetch = async (url, options) => {
        const path = new URL(url).pathname
        if (path === '/501204_tw.zip') return new Response(Buffer.from(zip, 'base64'))
        if (path === '/ebooks/search.opds/') return new Response(
          '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>三國志演義</title><link rel="subsection" href="/ebooks/23950.opds"/></entry></feed>')
        if (path === '/book/766/') return new Response('<a href="/book/766/1.html">开始阅读</a>')
        if (path === '/book/766/1.html') return new Response('<div class="word_read"><h3>第一节</h3><p>在线正文测试。</p></div><a href="/book/766/2.html">下一章</a>')
        if (path === '/book/766/2.html') return new Response('<div class="word_read"><h3>第二节</h3><p>下一节正文。</p></div>')
        if (path === '/list/') return new Response('<span class="s2"><a href="/book/555/">测试书目</a></span>')
        if (path === '/search.html' && options.method === 'POST' && options.body.get('s') === '会说话的肘子') {
          return new Response('<ul class="sort_list"><li><span class="s2"><a href="/book/766/">夜的命名术</a></span><span class="s5">会说话的肘子</span></li></ul>')
        }
        return new Response('', { status: 404 })
      }
    }, fixture)
  }

  const page = await app.firstWindow()
  const button = name => page.getByRole('button', { name, exact: true })
  const row = title => page.locator('.source-book').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  const sources = page.getByRole('group', { name: '已解锁书源' })
  const chapter = page.getByRole('article', { name: '在线阅读' })
  const errors = []
  page.on('pageerror', error => errors.push(error))
  await page.getByRole('heading', { name: '我的书架' }).waitFor()
  assert.equal(await button('书源').count(), 0)

  async function unlock(key) {
    const dialog = page.getByRole('dialog')
    if (!await dialog.isVisible()) await button('网络导入').click()
    await dialog.getByLabel('网址').fill(key)
    await dialog.getByRole('button', { name: '继续' }).click()
  }

  await unlock('www.4396778.sy.example.com')
  await page.getByRole('alert').getByText('这个地址暂时无法导入。').waitFor()
  assert.equal(await button('书源').count(), 0)

  await unlock('https://www.4396776.sy/')
  await row('巴黎茶花女遗事').waitFor()
  assert.deepEqual(await page.locator('.source-book h2').allTextContents(), ['巴黎茶花女遗事', '伊索寓言', '仲夏夜之梦'])
  assert.deepEqual(await sources.getByRole('button').allTextContents(), ['经典西方书籍'])
  if (process.env.SOFA_TEST_LIVE_SOURCES) {
    await row('巴黎茶花女遗事').getByRole('button', { name: '下载' }).click()
    await row('巴黎茶花女遗事').getByRole('button', { name: '已下载' }).waitFor({ timeout: 55_000 })
  }

  await unlock('www.4396778.sy')
  await row('夜的命名术').waitFor({ timeout: 55_000 })
  assert.equal(await row('夜的命名术').getByRole('button', { name: '下载' }).count(), 0)
  await row('夜的命名术').getByRole('button', { name: '阅读' }).click()
  await chapter.locator('.source-reader-text').waitFor({ timeout: 55_000 })
  const first = await chapter.locator('.source-reader-text').textContent()
  assert.ok(first.length > 5)
  await chapter.getByRole('button', { name: '下一节' }).click()
  await page.waitForFunction(first => {
    const text = document.querySelector('.source-reader-text')?.textContent
    return text && text !== first
  }, first, { timeout: 55_000 })
  if (process.env.SOFA_TEST_LIVE_SOURCES) {
    await chapter.getByRole('button', { name: '目录', exact: true }).click()
    const toc = page.getByRole('region', { name: '在线目录' })
    await toc.getByRole('button', { name: /^第1章 / }).waitFor({ timeout: 55_000 })
    await toc.getByRole('button', { name: '加载更多章节' }).click()
    await toc.getByRole('button', { name: /^第100章 / }).waitFor({ timeout: 55_000 })
    await toc.getByRole('button', { name: /^第2章 / }).click()
    await chapter.getByRole('heading', { name: /^第2章 / }).waitFor({ timeout: 55_000 })
  }
  await chapter.getByRole('button', { name: '返回书源' }).click()

  await page.getByLabel('书名或作者').fill('会说话的肘子')
  await button('搜索书源').click()
  await row('夜的命名术').waitFor({ timeout: 55_000 })
  assert.match(await row('夜的命名术').textContent(), /会说话的肘子/)
  await button('清除搜索').click()
  await row('折下').getByRole('button', { name: '下载', exact: true }).click()
  await row('折下').getByRole('button', { name: '已下载' }).waitFor({ timeout: 55_000 })
  await unlock('www.4396777.sy')
  await page.locator('.source-book').getByRole('heading', { name: /三國志演義/ }).waitFor({ timeout: 55_000 })
  await page.reload()
  await button('书源').click()
  assert.deepEqual(await sources.getByRole('button').allTextContents(), ['经典西方书籍', '网络小说', '经典中文书籍'])
  await button('书架').click()
  const saved = page.locator('.open-card').filter({ hasText: '折下' })
  await saved.click()
  await page.locator('.reader .reading-message').waitFor({ state: 'hidden', timeout: 15_000 })
  assert.equal(await page.locator('.reader .reading-message[role="alert"]').count(), 0)
  const frame = page.frames().find(frame => frame.url().startsWith('blob:'))
  assert.ok(frame)
  if (!process.env.SOFA_TEST_LIVE_SOURCES) await frame.getByText('网络书源下载测试。').waitFor()
  if (process.env.SOFA_TEST_LIVE_SOURCES) {
    await page.reload()
    await button('书架').click()
    await page.locator('.open-card').filter({ hasText: '巴黎茶花女遗事' }).click()
    await page.locator('.reader .reading-message').waitFor({ state: 'hidden', timeout: 15_000 })
    assert.equal(await page.locator('.reader .reading-message[role="alert"]').count(), 0)
    assert.ok(page.frames().some(frame => frame.url().startsWith('blob:')))
  }
  assert.deepEqual(errors, [])
  console.info('通过：书源解锁、译本目录、在线阅读、作者搜索、下载入库及重载后阅读。')
} finally {
  await app?.close()
  await rm(profile, { recursive: true, force: true })
}
