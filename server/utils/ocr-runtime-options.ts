export const OCR_RUNTIME_OPTIONS_MAX_BYTES = 4 * 1024

export const OCR_RUNTIME_BOOLEAN_OPTION_KEYS = [
  'useDocOrientationClassify',
  'useDocUnwarping',
  'useLayoutDetection',
  'useChartRecognition',
  'useSealRecognition',
  'useOcrForImageBlock',
  'formatBlockContent',
] as const

export const OCR_RUNTIME_TIMEOUT_LIMITS = {
  requestTimeoutMs: { min: 10_000, max: 300_000 },
  pollTimeoutMs: { min: 60_000, max: 1_800_000 },
} as const

export const OCR_RUNTIME_BOOLEAN_DEFAULTS = {
  useDocOrientationClassify: true,
  useDocUnwarping: true,
  useLayoutDetection: true,
  useChartRecognition: false,
  useSealRecognition: true,
  useOcrForImageBlock: true,
  formatBlockContent: true,
} as const

export const OCR_RUNTIME_TIMEOUT_DEFAULTS = {
  requestTimeoutMs: 120_000,
  pollTimeoutMs: 600_000,
} as const

export type OcrRuntimeBooleanOptionKey = typeof OCR_RUNTIME_BOOLEAN_OPTION_KEYS[number]
export type OcrRuntimeTimeoutKey = keyof typeof OCR_RUNTIME_TIMEOUT_LIMITS

export type OcrRuntimeOptions
  = Partial<Record<OcrRuntimeBooleanOptionKey, boolean>>
    & Partial<Record<OcrRuntimeTimeoutKey, number>>

export type OcrRuntimeDocumentOptions = Record<OcrRuntimeBooleanOptionKey, boolean>

export type OcrRuntimeOptionsValidationErrorCode
  = | 'invalid-json'
    | 'payload-too-large'
    | 'unknown-option'
    | 'invalid-option'
    | 'out-of-range'

export class OcrRuntimeOptionsValidationError extends Error {
  readonly code: OcrRuntimeOptionsValidationErrorCode

  constructor(code: OcrRuntimeOptionsValidationErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'OcrRuntimeOptionsValidationError'
    this.code = code
  }
}

export function validOcrRuntimeTimeout(
  key: OcrRuntimeTimeoutKey,
  value: unknown,
  fallback: number = OCR_RUNTIME_TIMEOUT_DEFAULTS[key],
): number {
  const limits = OCR_RUNTIME_TIMEOUT_LIMITS[key]
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= limits.min && parsed <= limits.max
    ? parsed
    : fallback
}

export function buildOcrRuntimeStatus(input: {
  configured: boolean
  requestTimeoutMs?: unknown
  pollTimeoutMs?: unknown
}) {
  return {
    configured: input.configured,
    engine: 'paddleocr-official-api' as const,
    model: 'PaddleOCR-VL-1.6' as const,
    settings: {
      defaults: {
        ...OCR_RUNTIME_BOOLEAN_DEFAULTS,
        requestTimeoutMs: validOcrRuntimeTimeout('requestTimeoutMs', input.requestTimeoutMs),
        pollTimeoutMs: validOcrRuntimeTimeout('pollTimeoutMs', input.pollTimeoutMs),
      },
      writableKeys: [
        ...OCR_RUNTIME_BOOLEAN_OPTION_KEYS,
        'requestTimeoutMs',
        'pollTimeoutMs',
      ] as const,
      timeoutLimits: OCR_RUNTIME_TIMEOUT_LIMITS,
      maxPayloadBytes: OCR_RUNTIME_OPTIONS_MAX_BYTES,
    },
  }
}

export function resolveOcrRuntimeOptions(
  options: OcrRuntimeOptions,
  serverDefaults: {
    requestTimeoutMs?: unknown
    pollTimeoutMs?: unknown
  } = {},
) {
  const documentOptions: OcrRuntimeDocumentOptions = {
    useDocOrientationClassify:
      options.useDocOrientationClassify ?? OCR_RUNTIME_BOOLEAN_DEFAULTS.useDocOrientationClassify,
    useDocUnwarping:
      options.useDocUnwarping ?? OCR_RUNTIME_BOOLEAN_DEFAULTS.useDocUnwarping,
    useLayoutDetection:
      options.useLayoutDetection ?? OCR_RUNTIME_BOOLEAN_DEFAULTS.useLayoutDetection,
    useChartRecognition:
      options.useChartRecognition ?? OCR_RUNTIME_BOOLEAN_DEFAULTS.useChartRecognition,
    useSealRecognition:
      options.useSealRecognition ?? OCR_RUNTIME_BOOLEAN_DEFAULTS.useSealRecognition,
    useOcrForImageBlock:
      options.useOcrForImageBlock ?? OCR_RUNTIME_BOOLEAN_DEFAULTS.useOcrForImageBlock,
    formatBlockContent:
      options.formatBlockContent ?? OCR_RUNTIME_BOOLEAN_DEFAULTS.formatBlockContent,
  }
  const serverRequestTimeoutMs = validOcrRuntimeTimeout(
    'requestTimeoutMs',
    serverDefaults.requestTimeoutMs,
  )
  const serverPollTimeoutMs = validOcrRuntimeTimeout(
    'pollTimeoutMs',
    serverDefaults.pollTimeoutMs,
  )

  return {
    documentOptions,
    requestTimeoutMs: validOcrRuntimeTimeout(
      'requestTimeoutMs',
      options.requestTimeoutMs,
      serverRequestTimeoutMs,
    ),
    pollTimeoutMs: validOcrRuntimeTimeout(
      'pollTimeoutMs',
      options.pollTimeoutMs,
      serverPollTimeoutMs,
    ),
  }
}

const BOOLEAN_OPTION_KEY_SET = new Set<string>(OCR_RUNTIME_BOOLEAN_OPTION_KEYS)
const TIMEOUT_KEY_SET = new Set<string>(Object.keys(OCR_RUNTIME_TIMEOUT_LIMITS))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseOcrRuntimeOptionsJson(raw: string): OcrRuntimeOptions {
  if (!raw.trim()) {
    throw new OcrRuntimeOptionsValidationError('invalid-json', 'OCR 参数必须是 JSON 对象')
  }
  if (new TextEncoder().encode(raw).byteLength > OCR_RUNTIME_OPTIONS_MAX_BYTES) {
    throw new OcrRuntimeOptionsValidationError(
      'payload-too-large',
      `OCR 参数不能超过 ${OCR_RUNTIME_OPTIONS_MAX_BYTES} 字节`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  }
  catch (error) {
    throw new OcrRuntimeOptionsValidationError('invalid-json', 'OCR 参数不是合法 JSON', { cause: error })
  }
  if (!isRecord(parsed))
    throw new OcrRuntimeOptionsValidationError('invalid-json', 'OCR 参数必须是 JSON 对象')

  const result: OcrRuntimeOptions = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (BOOLEAN_OPTION_KEY_SET.has(key)) {
      if (typeof value !== 'boolean') {
        throw new OcrRuntimeOptionsValidationError(
          'invalid-option',
          `${key} 必须是 true 或 false`,
        )
      }
      result[key as OcrRuntimeBooleanOptionKey] = value
      continue
    }

    if (TIMEOUT_KEY_SET.has(key)) {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new OcrRuntimeOptionsValidationError(
          'invalid-option',
          `${key} 必须是整数毫秒值`,
        )
      }
      const limits = OCR_RUNTIME_TIMEOUT_LIMITS[key as OcrRuntimeTimeoutKey]
      if (value < limits.min || value > limits.max) {
        throw new OcrRuntimeOptionsValidationError(
          'out-of-range',
          `${key} 必须在 ${limits.min}–${limits.max} 毫秒之间`,
        )
      }
      result[key as OcrRuntimeTimeoutKey] = value
      continue
    }

    throw new OcrRuntimeOptionsValidationError(
      'unknown-option',
      `不支持的 OCR 参数：${key}`,
    )
  }

  return result
}

export function parseLegacyOcrBooleanOption(
  values: string[],
  name: string,
): boolean | undefined {
  if (values.length > 1) {
    throw new OcrRuntimeOptionsValidationError(
      'invalid-option',
      `${name} 只能提交一次`,
    )
  }
  if (!values[0])
    return undefined

  const value = values[0].trim().toLowerCase()
  if (value === 'true')
    return true
  if (value === 'false')
    return false
  throw new OcrRuntimeOptionsValidationError(
    'invalid-option',
    `${name} 必须是 true 或 false`,
  )
}
