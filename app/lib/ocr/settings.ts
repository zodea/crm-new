export interface OcrRuntimeStatus {
  configured: boolean
  engine: 'paddleocr-official-api'
  model: 'PaddleOCR-VL-1.6'
}

export interface OcrRecognitionSettings {
  useDocOrientationClassify: boolean
  useDocUnwarping: boolean
  useLayoutDetection: boolean
  useChartRecognition: boolean
  useSealRecognition: boolean
  useOcrForImageBlock: boolean
  formatBlockContent: boolean
  requestTimeoutMs: number
  pollTimeoutMs: number
  /**
   * 预留给全局人工校对分档。当前识别调用不会发送这两个字段，
   * 页面也必须保持禁用，直到发票/送货单判读统一消费它们。
   */
  passThreshold: number
  attentionThreshold: number
}

export type OcrRuntimeOptions = Pick<
  OcrRecognitionSettings,
  | 'useDocOrientationClassify'
  | 'useDocUnwarping'
  | 'useLayoutDetection'
  | 'useChartRecognition'
  | 'useSealRecognition'
  | 'useOcrForImageBlock'
  | 'formatBlockContent'
  | 'requestTimeoutMs'
  | 'pollTimeoutMs'
>

export interface OcrSettingsDatabase {
  execute: (sql: string, params?: unknown[]) => Promise<void>
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

export const OCR_TIMEOUT_LIMITS = {
  requestTimeoutMs: { min: 10_000, max: 300_000 },
  pollTimeoutMs: { min: 60_000, max: 1_800_000 },
} as const

const DEFAULT_OCR_RECOGNITION_SETTINGS: Readonly<OcrRecognitionSettings> = {
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

const BOOLEAN_SETTING_KEYS = [
  'useDocOrientationClassify',
  'useDocUnwarping',
  'useLayoutDetection',
  'useChartRecognition',
  'useSealRecognition',
  'useOcrForImageBlock',
  'formatBlockContent',
] as const

export function createDefaultOcrRecognitionSettings(): OcrRecognitionSettings {
  return { ...DEFAULT_OCR_RECOGNITION_SETTINGS }
}

function isIntegerInRange(value: unknown, limits: { min: number, max: number }): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= limits.min
    && value <= limits.max
}

export function normalizeOcrRecognitionSettings(value: unknown): OcrRecognitionSettings {
  const defaults = createDefaultOcrRecognitionSettings()
  if (!isRecord(value))
    return defaults

  for (const key of BOOLEAN_SETTING_KEYS) {
    if (typeof value[key] === 'boolean')
      defaults[key] = value[key]
  }

  if (isIntegerInRange(value.requestTimeoutMs, OCR_TIMEOUT_LIMITS.requestTimeoutMs))
    defaults.requestTimeoutMs = value.requestTimeoutMs
  if (isIntegerInRange(value.pollTimeoutMs, OCR_TIMEOUT_LIMITS.pollTimeoutMs))
    defaults.pollTimeoutMs = value.pollTimeoutMs

  const passThreshold = value.passThreshold
  const attentionThreshold = value.attentionThreshold
  if (
    typeof passThreshold === 'number'
    && typeof attentionThreshold === 'number'
    && attentionThreshold >= 0
    && passThreshold <= 1
    && attentionThreshold < passThreshold
  ) {
    defaults.passThreshold = passThreshold
    defaults.attentionThreshold = attentionThreshold
  }

  return defaults
}

export function toOcrRuntimeOptions(settings: OcrRecognitionSettings): OcrRuntimeOptions {
  const normalized = normalizeOcrRecognitionSettings(settings)
  return {
    useDocOrientationClassify: normalized.useDocOrientationClassify,
    useDocUnwarping: normalized.useDocUnwarping,
    useLayoutDetection: normalized.useLayoutDetection,
    useChartRecognition: normalized.useChartRecognition,
    useSealRecognition: normalized.useSealRecognition,
    useOcrForImageBlock: normalized.useOcrForImageBlock,
    formatBlockContent: normalized.formatBlockContent,
    requestTimeoutMs: normalized.requestTimeoutMs,
    pollTimeoutMs: normalized.pollTimeoutMs,
  }
}

export async function loadOcrRecognitionSettings(
  database: OcrSettingsDatabase,
): Promise<OcrRecognitionSettings> {
  const [row] = await database.select<{ settings_json: string }>(
    `SELECT settings_json FROM ocr_settings WHERE id = 'default'`,
  )
  if (!row)
    return createDefaultOcrRecognitionSettings()

  try {
    return normalizeOcrRecognitionSettings(JSON.parse(row.settings_json) as unknown)
  }
  catch {
    return createDefaultOcrRecognitionSettings()
  }
}

export async function saveOcrRecognitionSettings(
  database: OcrSettingsDatabase,
  settings: OcrRecognitionSettings,
): Promise<OcrRecognitionSettings> {
  const normalized = normalizeOcrRecognitionSettings(settings)
  await database.execute(
    `INSERT INTO ocr_settings (id, settings_json, updated_at)
     VALUES ('default', ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`,
    [JSON.stringify(normalized)],
  )
  return normalized
}

export interface OcrDocumentSupport {
  id: 'invoice' | 'delivery' | 'boq'
  documentType: string
  availability: 'available' | 'unavailable'
  engine: string
  workflow: string
  note: string
}

export const OCR_DOCUMENT_SUPPORT: OcrDocumentSupport[] = [
  {
    id: 'invoice',
    documentType: '发票',
    availability: 'available',
    engine: 'PaddleOCR-VL 1.6',
    workflow: '官方云端代理 → 发票规则解析 → 人工核对',
    note: '识别结果仅作预填，归属和归档仍由人工确认。',
  },
  {
    id: 'delivery',
    documentType: '送货单',
    availability: 'available',
    engine: 'PaddleOCR-VL 1.6',
    workflow: '图片预处理 → 官方云端代理 → 送货单规则解析',
    note: '手写和低置信明细必须人工复核；不会静默切换其他引擎。',
  },
  {
    id: 'boq',
    documentType: '清单拆表',
    availability: 'unavailable',
    engine: '未接入',
    workflow: '当前使用文件解析和人工映射流程',
    note: '不得把现有清单导入流程标记为 OCR 识别。',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function fetchOcrRuntimeStatus(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<OcrRuntimeStatus> {
  const response = await fetchImpl('/api/ocr/status', {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok)
    throw new Error(`OCR 配置状态读取失败（HTTP ${response.status}）`)

  const value: unknown = await response.json()
  if (!isRecord(value)
    || typeof value.configured !== 'boolean'
    || value.engine !== 'paddleocr-official-api'
    || value.model !== 'PaddleOCR-VL-1.6') {
    throw new Error('OCR 配置状态格式无效')
  }
  return {
    configured: value.configured,
    engine: value.engine,
    model: value.model,
  }
}
