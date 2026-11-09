import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'

const root = await mkdtemp(join(tmpdir(), 'sofa-read-test-'))
const profile = join(root, 'profile')
const txt = join(root, '乙书.txt')
const moved = join(root, '搬移后.txt')
const pdf = join(root, '甲书.pdf')
const fbz = join(root, '风.fbz')
const epub = join(root, '海.epub')
await mkdir(profile)
await writeFile(txt, '第一章 启程\n' + '一段测试正文。\n'.repeat(120) + '第二章 归来\n独一无二的搜索词。\n' + '归来后的正文。\n'.repeat(65) + '第三章 远行\n最后一段正文。')
const document = await PDFDocument.create()
document.addPage().drawText('First page')
document.addPage().drawText('Second page')
await writeFile(pdf, await document.save())
const fb = new JSZip()
fb.file('book.fb2', '<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>风</book-title><lang>zh</lang></title-info></description><body><section><title><p>风之章</p></title><p>风吹过山谷。</p></section></body></FictionBook>')
await writeFile(fbz, await fb.generateAsync({ type: 'nodebuffer' }))
const ep = new JSZip()
ep.file('mimetype', 'application/epub+zip')
ep.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
ep.file('book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">sofa-test</dc:identifier><dc:title>海</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>')
ep.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="ch.xhtml">海之章</a></li></ol></nav></body></html>')
ep.file('ch.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>海之章</title></head><body><h1>海之章</h1><p>海潮拍岸。</p></body></html>')
await writeFile(epub, await ep.generateAsync({ type: 'nodebuffer' }))

let app
let page
const pageErrors = []
async function launch() {
  app = await electron.launch({ executablePath: electronPath, args: ['tests/launch-electron.cjs'], env: { ...process.env, SOFA_TEST_PROFILE: profile } })
  page = await app.firstWindow()
  page.setDefaultTimeout(5500)
  page.on('pageerror', error => { pageErrors.push(error); console.error('页面错误', error) })
  page.on('console', message => {
    if (message.type() === 'error') console.error('页面日志', message.text())
  })
  await page.getByRole('heading', { name: '我的书架' }).waitFor()
}

const button = name => page.getByRole('button', { name, exact: true })
async function readerTap(ratio = .5, duration = 0) {
  const box = await page.locator('.reading-body').boundingBox()
  await page.mouse.move(box.x + box.width * ratio, box.y + box.height * (duration ? .25 : .4))
  await page.mouse.down()
  if (duration) await page.waitForTimeout(duration)
  await page.mouse.up()
}
async function backToShelf() {
  if (!await button('返回书库').isVisible()) await readerTap()
  await button('返回书库').click()
  await page.getByText('再次点击返回', { exact: false }).waitFor()
  await page.waitForTimeout(130)
  await button('返回书库').click()
  await page.locator('.reader').waitFor({ state: 'detached' })
}
const chapter = label => page.locator('.chapter-line').getByText(label, { exact: true })
async function choose(paths, trigger) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
  }, paths)
  await button(trigger).click()
}
async function open(name) {
  await page.locator('.open-card').filter({ has: page.getByText(name, { exact: true }) }).click()
}
const optional = [process.env.SOFA_TEST_AZW, process.env.SOFA_TEST_AZW3].filter(Boolean)

try {
  await launch()
  await choose([txt, pdf, fbz, epub, ...optional], '＋ 导入书籍')
  await page.locator('.book-card').last().waitFor()
  assert.equal(await page.locator('.book-card').count(), 4 + optional.length)
  const library = JSON.parse(await readFile(join(profile, 'library.json'), 'utf8'))
  assert.equal(library.find(book => book.format === 'txt').path, txt)
  assert.equal(library.find(book => book.format === 'txt').bytes, Buffer.byteLength(await readFile(txt, 'utf8')))

  await page.getByLabel('新分类名称').fill('小说')
  await button('创建分类').click()
  await page.getByLabel('乙书的分类').selectOption('小说')
  await button('小说').click()
  assert.equal(await page.locator('.book-card').count(), 1)
  await page.getByRole('button', { name: /^全部书籍/ }).click()
  await page.getByLabel('排序').selectOption('name')
  assert.equal(await page.locator('.open-card > strong').filter({ hasText: /[甲乙]书/ }).first().textContent(), '甲书')

  await open('乙书')
  await chapter('第一章 启程').waitFor()
  await page.locator('.reading-message').waitFor({ state: 'hidden' })
  await readerTap(.5, 240)
  assert.equal(await page.getByRole('navigation', { name: '阅读菜单' }).count(), 0)
  await readerTap()
  await button('全文搜索').click()
  await page.getByLabel('搜索关键词').fill('独一无二的搜索词')
  await button('搜索').click()
  await page.getByText('找到 1 条匹配').waitFor()
  await page.getByRole('button', { name: /独一无二的搜索词/ }).click()
  await chapter('第二章 归来').waitFor()
  await readerTap()
  await button('目录').click()
  await button('第二章 归来').click()
  await chapter('第二章 归来').waitFor()
  await readerTap()
  await button('快速书签').click()
  await button('笔记').click()
  await button('写笔记').click()
  await page.getByLabel('笔记内容').fill('重读这一段。')
  await button('保存').click()
  await button('关闭面板').click()
  await readerTap()
  await button('设置').click()
  await button('深色').click()
  await button('更多设置').click()
  await page.getByLabel('显示章节名').uncheck()
  assert.equal(await page.locator('.chapter-line').textContent(), '')
  await page.getByLabel('显示章节名').check()
  await page.getByLabel('阅读模式').selectOption('scroll')
  await button('返回阅读页').click()
  await chapter('第二章 归来').waitFor()
  await readerTap()
  await button('目录').click()
  await button('第一章 启程').click()
  await chapter('第一章 启程').waitFor()
  await readerTap(.85)
  assert.equal(await page.getByRole('button', { name: '向前滚动' }).count(), 0)
  for (let index = 0; index < 24 && !await chapter('第二章 归来').isVisible(); index++) {
    await page.mouse.wheel(0, 420)
    await page.waitForTimeout(80)
  }
  await chapter('第二章 归来').waitFor({ timeout: 3500 })
  await readerTap()
  await button('目录').click()
  await button('第二章 归来').click()
  await chapter('第二章 归来').waitFor()
  await backToShelf()

  for (const [name, label] of [['海', '海之章'], ['风', '风之章']]) {
    await open(name)
    await chapter(label).waitFor()
    await backToShelf()
  }

  for (const fixture of optional) {
    const name = fixture.split('/').at(-1).replace(/\.[^.]+$/, '')
    await open(name)
    await page.locator('.reading-status > span').waitFor()
    await backToShelf()
  }

  await open('甲书')
  await chapter('第 1 页').waitFor()
  await page.locator('.pdfViewer canvas').first().waitFor()
  await readerTap()
  await button('设置').click()
  await button('更多设置').click()
  await page.getByLabel('阅读模式').selectOption('page')
  await button('返回阅读页').click()
  await readerTap(.85)
  await chapter('第 2 页').waitFor()
  await readerTap()
  const progress = page.getByRole('slider', { name: '阅读进度' })
  await progress.press('Home')
  await chapter('第 1 页').waitFor()
  await progress.press('End')
  await chapter('第 2 页').waitFor()
  await button('全文搜索').click()
  await page.getByLabel('搜索关键词').fill('First page')
  await button('搜索').click()
  await page.getByText('找到 1 条匹配').waitFor()
  await button('First page').click()
  await chapter('第 1 页').waitFor()
  await readerTap(.85)
  await chapter('第 2 页').waitFor()
  assert.equal(await page.locator('.reading-status > span').textContent(), '2 / 2')
  await backToShelf()
  await button('阅读记录').click()
  assert.match(await page.locator('.history-feature').textContent(), /甲书/)
  assert.equal(await page.locator('.history button').count(), Math.min(5, 4 + optional.length))

  await app.close()
  app = null
  await launch()
  await button('小说').click()
  assert.equal(await page.locator('.book-card').count(), 1)
  await open('乙书')
  await chapter('第二章 归来').waitFor()
  await readerTap()
  await button('笔记').click()
  assert.match(await page.locator('.reader-sheet').textContent(), /重读这一段。/)
  assert.equal(await page.locator('.mark').count(), 1)
  await button('关闭面板').click()
  await readerTap()
  await button('书签').click()
  assert.equal(await page.locator('.mark').count(), 1)
  await button('关闭面板').click()
  await backToShelf()
  await rename(txt, moved)
  await open('乙书')
  await page.getByRole('alert').filter({ hasText: '找不到书籍原文件' }).waitFor()
  await choose([moved], '重新定位原文件')
  await chapter('第二章 归来').waitFor()
  assert.deepEqual(pageErrors, [])
  console.log('本地冒烟通过：原文件导入、分类排序、目录、连续滚动、搜索、PDF 翻页、笔记书签、最近五本、两次返回、重启续读和重新定位。')
} catch (error) {
  if (process.env.SOFA_TEST_SCREENSHOT) await page?.screenshot({ path: process.env.SOFA_TEST_SCREENSHOT })
  throw error
} finally {
  await app?.close()
  await rm(root, { recursive: true, force: true })
}
