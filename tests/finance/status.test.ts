import { describe, expect, it } from 'vitest'
import { financeStatusLabel } from '~/lib/finance/status'

describe('财务状态展示', () => {
  it('把数据库状态映射为用户可读中文', () => {
    expect(financeStatusLabel('submitted')).toBe('已提交')
    expect(financeStatusLabel('needs_review')).toBe('待核对')
  })

  it('未知状态保留原值，空值回退草稿', () => {
    expect(financeStatusLabel('custom_state')).toBe('custom_state')
    expect(financeStatusLabel('')).toBe('草稿')
  })
})
