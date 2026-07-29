export interface OcrRuntimeStatus {
  configured: boolean
  engine: 'paddleocr-official-api'
  model: 'PaddleOCR-VL-1.6'
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
