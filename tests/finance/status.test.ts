import { describe, expect, it } from 'vitest'
import { financeStatusLabel, financeStatusTone } from '~/lib/finance/status'

describe('财务状态展示', () => {
  it.each([
    { case: '\'confirmed\'', input: 'confirmed', expected: 'ok' },
    { case: '\'approved\'', input: 'approved', expected: 'ok' },
    { case: '\'draft\'', input: 'draft', expected: 'neutral' },
    { case: '\'submitted\'', input: 'submitted', expected: 'brand' },
  ])('已确认为成功、草稿为中性，跨页复用同一状态语义 / financeStatusTone：$case', ({ input, expected }) => {
    expect(financeStatusTone(input)).toBe(expected)
  })
  it.each([
    { case: '\'submitted\'', input: 'submitted', expected: '已提交' },
    { case: '\'needs_review\'', input: 'needs_review', expected: '待核对' },
    { case: '\'void\'', input: 'void', expected: '已作废' },
    { case: '\'作废\'', input: '作废', expected: '已作废' },
  ])('把数据库状态映射为用户可读中文 / financeStatusLabel：$case', ({ input, expected }) => {
    expect(financeStatusLabel(input)).toBe(expected)
  })

  it.each([
    { case: '\'custom_state\'', input: 'custom_state', expected: 'custom_state' },
    { case: '\'\'', input: '', expected: '草稿' },
  ])('未知状态保留原值，空值回退草稿 / financeStatusLabel：$case', ({ input, expected }) => {
    expect(financeStatusLabel(input)).toBe(expected)
  })
})
