import { describe, expect, it } from 'vitest'
import { extractLinks, findBrokenLinks, resolveTarget } from '../../scripts/check-md-links.mjs'

describe('相对链接提取', () => {
  it('跳过外链、站内锚点、行内代码和代码块', () => {
    const text = [
      '[外链](https://example.com) [锚点](#章节) [邮件](mailto:a@b.c)',
      '`[代码](./missing.md)` [正文](./guide.md#步骤 "标题")',
      '```text',
      '[块内](./missing.md)',
      '```',
      '![图](<./图 片.png>)',
    ].join('\n')
    expect(extractLinks(text)).toEqual([
      { line: 2, target: './guide.md#步骤' },
      { line: 6, target: './图 片.png' },
    ])
  })

  it('按源文件目录解析，去掉锚点并解码，拒绝本机绝对路径', () => {
    expect(resolveTarget('docs/a/b.md', '../c.md#x')).toBe('docs/c.md')
    expect(resolveTarget('docs/a.md', './%E5%9B%BE.png')).toBe('docs/图.png')
    expect(resolveTarget('docs/a.md', 'D:/repo/docs/x.md')).toBeNull()
  })
})

describe('失效链接判定', () => {
  const files: Record<string, string> = {
    'docs/a.md': '[存在](./b.md) [缺失](./gone.md) [已删](./old.md)',
    'docs/b.md': '[回链](./a.md)',
  }
  const exists = (path: string) => path in files
  const read = (path: string) => files[path]!

  it('全量模式报告全部失效目标', () => {
    expect(findBrokenLinks(Object.keys(files), { read, exists }).map(item => item.target)).toEqual(['./gone.md', './old.md'])
  })

  it('暂存模式只报告本次改动的文档或指向本次删除路径的链接', () => {
    const removed = new Set(['docs/old.md'])
    const only = (source: string, resolved: string | null) => resolved !== null && removed.has(resolved)
    expect(findBrokenLinks(Object.keys(files), { read, exists, only })).toEqual([
      { source: 'docs/a.md', line: 1, target: './old.md' },
    ])
  })
})
