import { describe, expect, it, vi } from 'vitest'
import {
  archivePath,
  createZip,
  sanitizeSegment,
} from '~/lib/project/archive'

const select = vi.hoisted(() => vi.fn())

vi.mock('~/lib/db/connection', () => ({ select }))

describe('档案路径清洗与 ZIP 打包', () => {
  it('清洗目录段并保持路径不允许穿越或覆盖保留名', () => {
    expect(sanitizeSegment('CON')).toBe('_CON')
    expect(archivePath('项目', '../附件:原件.pdf')).toBe('项目/未命名/附件-原件.pdf')
  })

  it('同一输入生成的 zip 字节序列稳定', () => {
    const first = createZip([
      { path: 'b.txt', data: new TextEncoder().encode('b') },
      { path: 'a.txt', data: new TextEncoder().encode('a') },
    ])
    const second = createZip([
      { path: 'a.txt', data: new TextEncoder().encode('a') },
      { path: 'b.txt', data: new TextEncoder().encode('b') },
    ])
    expect([...first]).toEqual([...second])
  })
})
