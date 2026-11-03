import { describe, expect, it } from 'vitest'
import {
  createDefaultOcrRecognitionSettings,
  loadOcrRecognitionSettings,
  normalizeOcrRecognitionSettings,
  saveOcrRecognitionSettings,
  toOcrRuntimeOptions,
} from '~/lib/ocr/settings'

const defaults = {
  useDocOrientationClassify: true,
  useDocUnwarping: true,
  useLayoutDetection: true,
  useChartRecognition: false,
  useSealRecognition: true,
  useOcrForImageBlock: true,
  formatBlockContent: true,
  requestTimeoutMs: 120_000,
  pollTimeoutMs: 600_000,
  passThreshold: 0.95,
  attentionThreshold: 0.85,
}

describe('ocr 本机偏好', () => {
  it('缺少或损坏记录时回到安全默认值', async () => {
    const database = {
      execute: async () => {},
      select: async <T>() => [{ settings_json: '{broken' }] as T[],
    }

    expect(await loadOcrRecognitionSettings(database))
      .toEqual(defaults)
    expect(await loadOcrRecognitionSettings({ ...database, select: async <T>() => [] as T[] })).toEqual(defaults)
  })

  it('收敛布尔值、超时和阈值范围', () => {
    expect(normalizeOcrRecognitionSettings({
      useChartRecognition: true,
      requestTimeoutMs: 45_000,
      pollTimeoutMs: 480_000,
      passThreshold: 0.9,
      attentionThreshold: 0.8,
    })).toMatchObject({
      useChartRecognition: true,
      requestTimeoutMs: 45_000,
      pollTimeoutMs: 480_000,
      passThreshold: 0.9,
      attentionThreshold: 0.8,
    })

    expect(normalizeOcrRecognitionSettings({
      requestTimeoutMs: 1,
      pollTimeoutMs: 99_999_999,
      passThreshold: 0.5,
      attentionThreshold: 0.8,
    })).toEqual(defaults)
  })

  it('保存规范化 JSON，识别载荷排除尚未接线的判读阈值', async () => {
    const calls: unknown[][] = []
    const database = {
      execute: async (_sql: string, params: unknown[] = []) => {
        calls.push(params)
      },
      select: async <T>() => [] as T[],
    }
    const saved = await saveOcrRecognitionSettings(database, {
      ...createDefaultOcrRecognitionSettings(),
      useSealRecognition: false,
      requestTimeoutMs: 60_000,
    })

    const expected = { ...defaults, useSealRecognition: false, requestTimeoutMs: 60_000 }
    expect(saved).toEqual(expected)
    expect(JSON.parse(String(calls[0]?.[0]))).toEqual(expected)
    expect(toOcrRuntimeOptions(saved)).toMatchObject({
      useSealRecognition: false,
      requestTimeoutMs: 60_000,
    })
    expect(toOcrRuntimeOptions(saved)).not.toHaveProperty('passThreshold')
  })
})
