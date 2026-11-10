import { describe, expect, it } from 'vitest'
import { SOURCE_FILE_LIMIT, SOURCE_TEXT_LIMIT, sourceRequestLimit } from '../src/shared/source-network'

describe('内置书源请求范围', () => {
  it('限制目录、章节及书籍文件的大小', () => {
    expect(sourceRequestLimit(new URL('https://www.gutenberg.org/ebooks/search.opds/?query=l.zh&start_index=26'))).toBe(SOURCE_TEXT_LIMIT)
    expect(sourceRequestLimit(new URL('https://www.xwbqgzw.com/book/766/613732_1.html'))).toBe(SOURCE_TEXT_LIMIT)
    expect(sourceRequestLimit(new URL('https://www.xwbqgzw.com/book/766/ml1.html'))).toBe(SOURCE_TEXT_LIMIT)
    expect(sourceRequestLimit(new URL('https://www.xwbqgzw.com/list/1_2/'))).toBe(SOURCE_TEXT_LIMIT)
    expect(sourceRequestLimit(new URL('https://www.xwbqgzw.com/search.html'), '会说话的肘子')).toBe(SOURCE_TEXT_LIMIT)
    expect(sourceRequestLimit(new URL('https://www.xwbqgzw.com/search.html'))).toBe(0)
    expect(sourceRequestLimit(new URL('https://www.xwbqgzw.com/list/'), '书名')).toBe(0)
    expect(sourceRequestLimit(new URL('https://down7.ixdzs8.tw/501204_tw.zip'))).toBe(SOURCE_FILE_LIMIT)
  })

  it('拒绝口令、相似域名和任意跳转目的地', () => {
    for (const value of [
      'https://www.4396778.sy/',
      'https://www.xwbqgzw.com.example.com/book/766/',
      'https://www.xwbqgzw.com:1234/book/766/',
      'https://www.xwbqgzw.com/book/766/?next=https://example.com',
      'https://www.gutenberg.org/ebooks/search.opds/?query=l.en',
      'https://ws-export.wmcloud.org/?format=epub&lang=zh&page=其他'
    ]) expect(sourceRequestLimit(new URL(value))).toBe(0)
  })
})
