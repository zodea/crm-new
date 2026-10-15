import { describe, expect, it } from 'vitest'
import {
  CONFIDENCE_THRESHOLDS,
  confidenceTier,
  isRecognizableFile,
} from '~/lib/invoice/recognize'

describe('confidenceTier:置信度分档(边框色/角标/✓确认 依据)', () => {
  it.each([
    { case: '0.99', input: 0.99, expected: 'ok' },
    { case: 'CONFIDENCE_THRESHOLDS.ok', input: CONFIDENCE_THRESHOLDS.ok, expected: 'ok' },
    { case: '0.9', input: 0.9, expected: 'warn' },
    { case: 'CONFIDENCE_THRESHOLDS.warn', input: CONFIDENCE_THRESHOLDS.warn, expected: 'warn' },
    { case: '0.5', input: 0.5, expected: 'danger' },
  ])('≥ok 绿 / ≥warn 黄 / 其余红 / 无数据 null(人工录入字段不着色) / confidenceTier：$case', ({ input, expected }) => {
    expect(confidenceTier(input)).toBe(expected)
  })

  it.each([
    { case: 'null', input: null },
    { case: 'undefined', input: undefined },
  ])('≥ok 绿 / ≥warn 黄 / 其余红 / 无数据 null(人工录入字段不着色) / confidenceTier：$case', ({ input }) => {
    expect(confidenceTier(input)).toBeNull()
  })
})

describe('isRecognizableFile:上传文件类型判定(file input accept 与拖拽过滤的唯一定义源)', () => {
  it.each([
    { case: '\'a.pdf\'', input: 'a.pdf', expected: true },
    { case: '\'B.PNG\'', input: 'B.PNG', expected: true },
    { case: '\'c.jpg\'', input: 'c.jpg', expected: true },
    { case: '\'d.JPEG\'', input: 'd.JPEG', expected: true },
    { case: '\'e.txt\'', input: 'e.txt', expected: false },
    { case: '\'f.pdf.exe\'', input: 'f.pdf.exe', expected: false },
  ])('pdf/图片(含大写扩展名)放行,其余拒绝 / isRecognizableFile：$case', ({ input, expected }) => {
    expect(isRecognizableFile(input)).toBe(expected)
  })
})
