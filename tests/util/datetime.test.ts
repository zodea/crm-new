import { describe, expect, it } from 'vitest'
import { formatShanghaiDateTime } from '~/lib/util/datetime'

describe('datetime formatting', () => {
  it('把固定 UTC 时间转换为 Asia/Shanghai 本地时间', () => {
    expect(formatShanghaiDateTime('2026-07-30T16:20:30.000Z'))
      .toBe('2026-07-31 00:20:30')
  })

  it('把 SQLite 无时区 UTC 文本转换为 Asia/Shanghai 本地时间', () => {
    expect(formatShanghaiDateTime('2026-07-30 16:20:30'))
      .toBe('2026-07-31 00:20:30')
  })

  it('空值或无效时间使用回退文案', () => {
    expect(formatShanghaiDateTime(null)).toBe('—')
    expect(formatShanghaiDateTime('invalid', '未记录时间')).toBe('未记录时间')
  })
})
