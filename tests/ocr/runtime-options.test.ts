import type { OcrRuntimeOptionsValidationError } from '../../server/utils/ocr-runtime-options'
import { describe, expect, it } from 'vitest'
import {
  buildOcrRuntimeStatus,
  OCR_RUNTIME_OPTIONS_MAX_BYTES,
  parseLegacyOcrBooleanOption,
  parseOcrRuntimeOptionsJson,
  resolveOcrRuntimeOptions,
} from '../../server/utils/ocr-runtime-options'

describe('ocr 运行参数契约', () => {
  it('只接收 PaddleOCR-VL 已接入的布尔能力与有界超时', () => {
    expect(parseOcrRuntimeOptionsJson(JSON.stringify({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useLayoutDetection: true,
      useChartRecognition: true,
      useSealRecognition: false,
      useOcrForImageBlock: true,
      formatBlockContent: false,
      requestTimeoutMs: 45_000,
      pollTimeoutMs: 180_000,
    }))).toEqual({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useLayoutDetection: true,
      useChartRecognition: true,
      useSealRecognition: false,
      useOcrForImageBlock: true,
      formatBlockContent: false,
      requestTimeoutMs: 45_000,
      pollTimeoutMs: 180_000,
    })
  })

  it.each([
    { accessToken: 'must-not-enter' },
    { baseUrl: 'https://attacker.example' },
    { model: 'another-model' },
    { visualize: true },
    { unknownFlag: true },
  ])('拒绝未知键或服务端专属配置：%o', (value) => {
    expect(() => parseOcrRuntimeOptionsJson(JSON.stringify(value)))
      .toThrowError(expect.objectContaining<OcrRuntimeOptionsValidationError>({
        code: 'unknown-option',
      }))
  })

  it.each([
    [{ useDocUnwarping: 'false' }, 'invalid-option'],
    [{ requestTimeoutMs: 9_999 }, 'out-of-range'],
    [{ requestTimeoutMs: 300_001 }, 'out-of-range'],
    [{ pollTimeoutMs: 59_999 }, 'out-of-range'],
    [{ pollTimeoutMs: 1_800_001 }, 'out-of-range'],
    [{ pollTimeoutMs: 60_000.5 }, 'invalid-option'],
  ] as const)('拒绝错误类型或越界值：%o', (value, code) => {
    expect(() => parseOcrRuntimeOptionsJson(JSON.stringify(value)))
      .toThrowError(expect.objectContaining({ code }))
  })

  it('拒绝超过 4KB 的设置载荷', () => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(OCR_RUNTIME_OPTIONS_MAX_BYTES) })
    expect(() => parseOcrRuntimeOptionsJson(oversized))
      .toThrowError(expect.objectContaining({ code: 'payload-too-large' }))
  })

  it.each(['', '{broken', '[]', 'null'])('拒绝非 JSON 对象：%s', (raw) => {
    expect(() => parseOcrRuntimeOptionsJson(raw))
      .toThrowError(expect.objectContaining({ code: 'invalid-json' }))
  })

  it('旧版方向分类字段只允许提交一次且必须为布尔文本', () => {
    expect(parseLegacyOcrBooleanOption([], 'useDocOrientationClassify')).toBeUndefined()
    expect(parseLegacyOcrBooleanOption(['false'], 'useDocOrientationClassify')).toBe(false)
  })

  it.each([
    { case: '[\'true\', \'false\'] / \'useDocOrientationClassify\'', input: ['true', 'false'], argument2: 'useDocOrientationClassify', expected: expect.objectContaining({ code: 'invalid-option' }) },
    { case: '[\'yes\'] / \'useDocOrientationClassify\'', input: ['yes'], argument2: 'useDocOrientationClassify', expected: expect.objectContaining({ code: 'invalid-option' }) },
  ])('旧版方向分类字段只允许提交一次且必须为布尔文本 / parseLegacyOcrBooleanOption：$case', ({ input, argument2, expected }) => {
    expect(() => parseLegacyOcrBooleanOption(input, argument2)).toThrowError(expected)
  })

  it('状态响应只公开固定引擎、可写能力和安全默认值', () => {
    const status = buildOcrRuntimeStatus({
      configured: true,
      requestTimeoutMs: 45_000,
      pollTimeoutMs: 180_000,
    })

    expect(status).toMatchObject({
      configured: true,
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
      settings: {
        defaults: {
          useDocOrientationClassify: true,
          useDocUnwarping: true,
          useLayoutDetection: true,
          useChartRecognition: false,
          useSealRecognition: true,
          useOcrForImageBlock: true,
          formatBlockContent: true,
          requestTimeoutMs: 45_000,
          pollTimeoutMs: 180_000,
        },
        timeoutLimits: {
          requestTimeoutMs: { min: 10_000, max: 300_000 },
          pollTimeoutMs: { min: 60_000, max: 1_800_000 },
        },
        maxPayloadBytes: 4_096,
      },
    })
    expect(status.settings.writableKeys).toEqual([
      'useDocOrientationClassify',
      'useDocUnwarping',
      'useLayoutDetection',
      'useChartRecognition',
      'useSealRecognition',
      'useOcrForImageBlock',
      'formatBlockContent',
      'requestTimeoutMs',
      'pollTimeoutMs',
    ])
    expect(JSON.stringify(status)).not.toMatch(/token|baseUrl|accessToken/i)
  })

  it('状态默认超时越界时回退服务端安全值，不把无效配置公开给客户端', () => {
    expect(buildOcrRuntimeStatus({
      configured: false,
      requestTimeoutMs: -1,
      pollTimeoutMs: Number.NaN,
    }).settings.defaults).toMatchObject({
      requestTimeoutMs: 120_000,
      pollTimeoutMs: 600_000,
    })
  })

  it('将客户端覆盖项拆成上游文档能力与本次请求超时', () => {
    expect(resolveOcrRuntimeOptions({
      useDocUnwarping: false,
      useChartRecognition: true,
      requestTimeoutMs: 45_000,
    }, {
      requestTimeoutMs: 30_000,
      pollTimeoutMs: 240_000,
    })).toEqual({
      documentOptions: {
        useDocOrientationClassify: true,
        useDocUnwarping: false,
        useLayoutDetection: true,
        useChartRecognition: true,
        useSealRecognition: true,
        useOcrForImageBlock: true,
        formatBlockContent: true,
      },
      requestTimeoutMs: 45_000,
      pollTimeoutMs: 240_000,
    })
  })
})
