import { describe, expect, it } from 'vitest'
import { normalizeProjectStatus, PROJECT_STATUSES } from '~/lib/project/status'

describe('项目状态归一', () => {
  it.each((PROJECT_STATUSES).map(input => ({ input })))('合法枚举值原样保留：输入案例 %#', ({ input: status }) => {
    expect(normalizeProjectStatus(status)).toBe(status)
  })

  it.each([
    { case: '\'\'', input: '', expected: '筹备中' },
    { case: 'null', input: null, expected: '筹备中' },
    { case: 'undefined', input: undefined, expected: '筹备中' },
  ])('空值/未映射回落 schema 默认「筹备中」 / normalizeProjectStatus：$case', ({ input, expected }) => {
    expect(normalizeProjectStatus(input)).toBe(expected)
  })

  it.each([
    { case: '\'在建\'', input: '在建', expected: '筹备中' },
    { case: '\'完工\'', input: '完工', expected: '筹备中' },
    { case: '\'任意脏数据\'', input: '任意脏数据', expected: '筹备中' },
  ])('外部旧枚举等非法值回落「筹备中」，不写进非法阶段 / normalizeProjectStatus：$case', ({ input, expected }) => {
    expect(normalizeProjectStatus(input)).toBe(expected)
  })
})
