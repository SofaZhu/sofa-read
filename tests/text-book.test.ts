import { describe, expect, it } from 'vitest'
import { decodeText, makeTextBook, splitChapters } from '../src/renderer/text-book'
import { identifyFormat } from '../src/shared/book'

describe('导入格式与纯文本目录', () => {
  it('识别大小写和压缩书名后缀，拒绝其他 ZIP', () => {
    expect(identifyFormat('小说.FB2.ZIP')).toBe('fb2.zip')
    expect(identifyFormat('小说.AZW3')).toBe('azw3')
    expect(identifyFormat('档案.ZIP')).toBeUndefined()
  })

  it('识别中文章节、英文标题和无标题正文', () => {
    expect(splitChapters('无标题正文\r\n第一章 风\r\n海边\nChapter IV Rain\n岸上').map(item => item.label))
      .toEqual(['正文', '第一章 风', 'Chapter IV Rain'])
    expect(splitChapters(' \n\t')).toEqual([])
    expect(splitChapters('正文\n'.repeat(800))).toHaveLength(3)
  })

  it('识别常用编码，正文中的标签按文本显示', async () => {
    expect(decodeText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]).buffer)).toBe('中文')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]).buffer)).toBe('中')
    const book = makeTextBook('<img src=x>')
    try {
      expect(await (await fetch(book.sections[0].load())).text()).toContain('&lt;img src=x&gt;')
    } finally {
      book.destroy()
    }
  })
})
