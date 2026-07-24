export type OcrRecognitionErrorCode
  = | 'authentication'
    | 'invalid-request'
    | 'rate-limit'
    | 'service-unavailable'
    | 'api-error'
    | 'network'
    | 'request-timeout'
    | 'poll-timeout'
    | 'job-failed'
    | 'invalid-response'
    | 'invalid-result'
    | 'missing-token'
    | string

export class OcrRecognitionError extends Error {
  readonly code: OcrRecognitionErrorCode
  readonly retryable: boolean
  readonly statusCode?: number

  constructor(
    code: OcrRecognitionErrorCode,
    message: string,
    options: { retryable?: boolean, statusCode?: number, cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'OcrRecognitionError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.statusCode = options.statusCode
  }
}

export interface OcrRecognitionPage {
  pageIndex: number
  markdown: string
  prunedResult: unknown
  layoutRegions: unknown[]
  inputImageUrl?: string
}

export interface OcrRecognitionResult {
  engine: 'paddleocr-official-api'
  model: 'PaddleOCR-VL-1.6'
  jobId: string
  pages: OcrRecognitionPage[]
  markdownPages: string[]
  dataInfo: Record<string, unknown>
}

export interface RecognizeDocumentOptions {
  fetch?: typeof globalThis.fetch
  onProgress?: (percent: number) => void
  useDocOrientationClassify?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePage(value: unknown): OcrRecognitionPage | null {
  if (!isRecord(value)
    || typeof value.pageIndex !== 'number'
    || typeof value.markdown !== 'string'
    || !Array.isArray(value.layoutRegions)) {
    return null
  }
  return {
    pageIndex: value.pageIndex,
    markdown: value.markdown,
    prunedResult: value.prunedResult,
    layoutRegions: value.layoutRegions,
    inputImageUrl: typeof value.inputImageUrl === 'string' ? value.inputImageUrl : undefined,
  }
}

function parseResult(value: unknown): OcrRecognitionResult {
  if (!isRecord(value)
    || value.engine !== 'paddleocr-official-api'
    || value.model !== 'PaddleOCR-VL-1.6'
    || typeof value.jobId !== 'string'
    || !Array.isArray(value.pages)
    || !Array.isArray(value.markdownPages)
    || !isRecord(value.dataInfo)) {
    throw new OcrRecognitionError('invalid-response', 'OCR 服务返回的结果结构不完整')
  }

  const pages = value.pages.map(parsePage)
  if (!pages.length
    || pages.some(page => page == null)
    || !value.markdownPages.every(markdown => typeof markdown === 'string')) {
    throw new OcrRecognitionError('invalid-response', 'OCR 服务没有返回可用的页面结果')
  }

  return {
    engine: value.engine,
    model: value.model,
    jobId: value.jobId,
    pages: pages as OcrRecognitionPage[],
    markdownPages: value.markdownPages as string[],
    dataInfo: value.dataInfo,
  }
}

async function errorFromResponse(response: Response): Promise<OcrRecognitionError> {
  let payload: unknown
  try {
    payload = await response.json()
  }
  catch {
    payload = null
  }

  const root = isRecord(payload) ? payload : {}
  const detail = isRecord(root.data) ? root.data : root
  const code = typeof detail.code === 'string' ? detail.code : 'api-error'
  const message = typeof detail.message === 'string'
    ? detail.message
    : typeof root.statusMessage === 'string'
      ? root.statusMessage
      : `OCR 服务请求失败（HTTP ${response.status}）`
  return new OcrRecognitionError(code, message, {
    retryable: detail.retryable === true || response.status >= 500,
    statusCode: response.status,
  })
}

/**
 * 浏览器侧唯一 OCR 边界：原始 File 只发给同源 Nuxt 代理，Access Token 不进入客户端包。
 * 当前代理以一个长请求等待官方任务完成，因此进度只表达「已提交」与「已完成」，不伪造上游页进度。
 */
export async function recognizeDocument(
  file: File,
  options: RecognizeDocumentOptions = {},
): Promise<OcrRecognitionResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const form = new FormData()
  form.append('file', file)
  if (options.useDocOrientationClassify != null)
    form.append('useDocOrientationClassify', String(options.useDocOrientationClassify))
  options.onProgress?.(5)

  let response: Response
  try {
    response = await fetchImpl('/api/ocr/recognize', {
      method: 'POST',
      body: form,
    })
  }
  catch (error) {
    throw new OcrRecognitionError('network', '无法连接本地 OCR 代理，请检查应用服务后重试', {
      retryable: true,
      cause: error,
    })
  }

  if (!response.ok)
    throw await errorFromResponse(response)

  let payload: unknown
  try {
    payload = await response.json()
  }
  catch (error) {
    throw new OcrRecognitionError('invalid-response', 'OCR 服务返回了无法解析的响应', { cause: error })
  }

  const result = parseResult(payload)
  options.onProgress?.(100)
  return result
}
