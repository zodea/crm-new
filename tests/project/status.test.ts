import { describe, expect, it } from 'vitest'
import { normalizeProjectStatus, PROJECT_STATUSES } from '~/lib/project/status'

describe('项目状态归一', () => {
  it('合法枚举值原样保留', () => {
    for (const status of PROJECT_STATUSES)
      expect(normalizeProjectStatus(status)).toBe(status)
  })

  it('空值/未映射回落 schema 默认「筹备中」', () => {
    expect(normalizeProjectStatus('')).toBe('筹备中')
    expect(normalizeProjectStatus(null)).toBe('筹备中')
    expect(normalizeProjectStatus(undefined)).toBe('筹备中')
  })

  it('外部旧枚举等非法值回落「筹备中」，不写进非法阶段', () => {
    expect(normalizeProjectStatus('在建')).toBe('筹备中')
    expect(normalizeProjectStatus('完工')).toBe('筹备中')
    expect(normalizeProjectStatus('任意脏数据')).toBe('筹备中')
  })
})
