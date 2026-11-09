import { describe, expect, it } from 'vitest'
import { limitSearchQuery, searchExcerpt } from '../src/renderer/search-text'

describe('全文搜索文本长度', () => {
  it('按字符限制查询词，保留完整的补充区汉字', () => {
    expect(limitSearchQuery('𠮷'.repeat(21))).toBe('𠮷'.repeat(20))
  })

  it('将命中词留在最长五十字符的片段里', () => {
    const prefix = '前'.repeat(80)
    const query = '命中'.repeat(10)
    const excerpt = searchExcerpt(prefix + query + '后'.repeat(80), prefix.length)
    expect(excerpt).toContain(query)
    expect(Array.from(excerpt)).toHaveLength(50)
  })
})
