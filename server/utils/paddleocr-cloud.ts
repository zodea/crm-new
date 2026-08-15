import { OCR_RUNTIME_BOOLEAN_DEFAULTS } from './ocr-runtime-options'

export const PADDLE_OCR_DEFAULT_BASE_URL = 'https://paddleocr.aistudio-app.com'
export const PADDLE_OCR_MODEL = 'PaddleOCR-VL-1.6'

const JOBS_PATH = '/api/v2/ocr/jobs'
const INITIAL_POLL_INTERVAL_MS = 3_000
const POLL_INTERVAL_MULTIPLIER = 1.5
const MAX_POLL_INTERVAL_MS = 15_000
const SUBMIT_RETRY_DELAYS_MS = [1_500, 3_000] as const

export type PaddleOcrCloudErrorCode
  = | 'missing-token'
    | 'authentication'
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

export class PaddleOcrCloudError extends Error {
  readonly code: PaddleOcrCloudErrorCode
  readonly retryable: boolean
  readonly statusCode?: number

  constructor(
    code: PaddleOcrCloudErrorCode,
    message: string,
    options: { retryable?: boolean, statusCode?: number, cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'PaddleOcrCloudError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.statusCode = options.statusCode
  }
}

export interface PaddleOcrCloudPage {
  pageIndex: number
  markdown: string
  prunedResult: unknown
  layoutRegions: unknown[]
  inputImageUrl?: string
}

export interface PaddleOcrCloudResult {
  engine: 'paddleocr-official-api'
  model: typeof PADDLE_OCR_MODEL
  jobId: string
  pages: PaddleOcrCloudPage[]
  markdownPages: string[]
  dataInfo: Record<string, unknown>
}

export interface PaddleOcrCloudInput {
  fileName: string
  contentType: string
  data: Uint8Array
  pageRanges?: string
  options?: PaddleOcrCloudDocumentOptions
  /** @deprecated 请改用 options.useDocOrientationClassify。 */
  useDocOrientationClassify?: boolean
  onProgress?: (percent: number) => void
}

export interface PaddleOcrCloudClientOptions {
  accessToken: string
  baseUrl?: string
  requestTimeoutMs?: number
  pollTimeoutMs?: number
  fetch?: typeof globalThis.fetch
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
}

interface ApiPayload {
  code?: number | null
  msg?: unknown
  message?: unknown
  errorMsg?: unknown
  data?: unknown
}

interface JobStatus {
  state: 'pending' | 'running' | 'done' | 'failed'
  extractProgress?: {
    totalPages?: number
    extractedPages?: number
  }
  resultUrl?: {
    jsonUrl?: string
  }
  errorMsg?: string
}

export interface PaddleOcrCloudDocumentOptions {
  useDocOrientationClassify?: boolean
  useDocUnwarping?: boolean
  useLayoutDetection?: boolean
  useChartRecognition?: boolean
  useSealRecognition?: boolean
  useOcrForImageBlock?: boolean
  formatBlockContent?: boolean
}

export const PADDLE_OCR_DEFAULT_DOCUMENT_OPTIONS = {
  ...OCR_RUNTIME_BOOLEAN_DEFAULTS,
  restructurePages: false,
  returnMarkdownImages: false,
  visualize: false,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function shouldRetrySubmit(error: unknown): error is PaddleOcrCloudError {
  return error instanceof PaddleOcrCloudError
    && error.code === 'service-unavailable'
    && /队列|排队/.test(error.message)
}

function apiMessage(payload: ApiPayload): string {
  const direct = payload.msg || payload.errorMsg || payload.message
  if (direct)
    return String(direct)
  if (isRecord(payload.data) && payload.data.errorMsg)
    return String(payload.data.errorMsg)
  return 'PaddleOCR 服务返回错误'
}

function errorForStatus(statusCode: number, message: string): PaddleOcrCloudError {
  if (statusCode === 401 || statusCode === 403) {
    return new PaddleOcrCloudError('authentication', 'PaddleOCR Access Token 无效或已过期', {
      statusCode,
    })
  }
  if (statusCode === 400) {
    if (/队列|排队|稍后重试/.test(message)) {
      return new PaddleOcrCloudError('service-unavailable', message, {
        retryable: true,
        statusCode,
      })
    }
    return new PaddleOcrCloudError('invalid-request', message, { statusCode })
  }
  if (statusCode === 429) {
    return new PaddleOcrCloudError('rate-limit', 'PaddleOCR 服务请求过于频繁，请稍后重试', {
      retryable: true,
      statusCode,
    })
  }
  if (statusCode === 503 || statusCode === 504) {
    return new PaddleOcrCloudError('service-unavailable', 'PaddleOCR 服务暂时不可用，请稍后重试', {
      retryable: true,
      statusCode,
    })
  }
  return new PaddleOcrCloudError('api-error', message, {
    retryable: statusCode >= 500,
    statusCode,
  })
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function jobProgress(status: JobStatus): number | null {
  const total = status.extractProgress?.totalPages
  const extracted = status.extractProgress?.extractedPages
  if (!total || extracted == null)
    return null
  return clampProgress(extracted / total * 100)
}

function parseJobStatus(data: Record<string, unknown>): JobStatus {
  const state = data.state
  if (state !== 'pending' && state !== 'running' && state !== 'done' && state !== 'failed') {
    throw new PaddleOcrCloudError('invalid-response', `PaddleOCR 返回未知任务状态：${String(state)}`)
  }

  const progress = isRecord(data.extractProgress)
    ? {
        totalPages: typeof data.extractProgress.totalPages === 'number' ? data.extractProgress.totalPages : undefined,
        extractedPages: typeof data.extractProgress.extractedPages === 'number' ? data.extractProgress.extractedPages : undefined,
      }
    : undefined
  const resultUrl = isRecord(data.resultUrl)
    ? { jsonUrl: typeof data.resultUrl.jsonUrl === 'string' ? data.resultUrl.jsonUrl : undefined }
    : undefined

  return {
    state,
    extractProgress: progress,
    resultUrl,
    errorMsg: typeof data.errorMsg === 'string' ? data.errorMsg : undefined,
  }
}

function parseJsonLines(text: string): unknown[] {
  try {
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as unknown)
  }
  catch (error) {
    throw new PaddleOcrCloudError('invalid-result', 'PaddleOCR 结果不是合法 JSONL', { cause: error })
  }
}

function parseDocumentResult(lines: unknown[]): Pick<PaddleOcrCloudResult, 'pages' | 'markdownPages' | 'dataInfo'> {
  const pages: PaddleOcrCloudPage[] = []
  const dataInfo: Record<string, unknown> = {}

  try {
    for (const line of lines) {
      if (!isRecord(line) || !isRecord(line.result))
        throw new TypeError('缺少 result')
      const result = line.result
      if (isRecord(result.dataInfo))
        Object.assign(dataInfo, result.dataInfo)
      if (!Array.isArray(result.layoutParsingResults))
        throw new TypeError('缺少 layoutParsingResults')

      for (const rawPage of result.layoutParsingResults) {
        if (!isRecord(rawPage) || !isRecord(rawPage.markdown) || typeof rawPage.markdown.text !== 'string')
          throw new TypeError('缺少 markdown.text')
        const prunedResult = rawPage.prunedResult
        const layoutRegions = isRecord(prunedResult) && Array.isArray(prunedResult.parsing_res_list)
          ? prunedResult.parsing_res_list
          : []
        pages.push({
          pageIndex: pages.length,
          markdown: rawPage.markdown.text,
          prunedResult,
          layoutRegions,
          inputImageUrl: typeof rawPage.inputImage === 'string' ? rawPage.inputImage : undefined,
        })
      }
    }
  }
  catch (error) {
    if (error instanceof PaddleOcrCloudError)
      throw error
    throw new PaddleOcrCloudError('invalid-result', 'PaddleOCR 版面结果结构不完整', { cause: error })
  }

  if (pages.length === 0)
    throw new PaddleOcrCloudError('invalid-result', 'PaddleOCR 未返回任何可识别页面')

  return {
    pages,
    markdownPages: pages.map(page => page.markdown),
    dataInfo,
  }
}

export class PaddleOcrCloudClient {
  private readonly accessToken: string
  private readonly baseUrl: string
  private readonly requestTimeoutMs: number
  private readonly pollTimeoutMs: number
  private readonly fetch: typeof globalThis.fetch
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly now: () => number

  constructor(options: PaddleOcrCloudClientOptions) {
    const accessToken = options.accessToken.trim()
    if (!accessToken) {
      throw new PaddleOcrCloudError(
        'missing-token',
        '尚未配置 PaddleOCR Access Token，请在本机 .env 中设置 NUXT_PADDLE_OCR_ACCESS_TOKEN',
      )
    }

    this.accessToken = accessToken
    this.baseUrl = (options.baseUrl || PADDLE_OCR_DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000
    this.pollTimeoutMs = options.pollTimeoutMs ?? 600_000
    this.fetch = options.fetch ?? globalThis.fetch
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? Date.now
  }

  async recognize(input: PaddleOcrCloudInput): Promise<PaddleOcrCloudResult> {
    const jobId = await this.submit(input)
    input.onProgress?.(0)
    const jsonUrl = await this.poll(jobId, input.onProgress)
    const resultResponse = await this.request(jsonUrl)
    const text = await resultResponse.text()
    const parsed = parseDocumentResult(parseJsonLines(text))

    return {
      engine: 'paddleocr-official-api',
      model: PADDLE_OCR_MODEL,
      jobId,
      ...parsed,
    }
  }

  private async submit(input: PaddleOcrCloudInput): Promise<string> {
    const form = new FormData()
    form.append('model', PADDLE_OCR_MODEL)
    form.append('optionalPayload', JSON.stringify({
      ...PADDLE_OCR_DEFAULT_DOCUMENT_OPTIONS,
      ...input.options,
      useDocOrientationClassify: input.useDocOrientationClassify
        ?? input.options?.useDocOrientationClassify
        ?? PADDLE_OCR_DEFAULT_DOCUMENT_OPTIONS.useDocOrientationClassify,
    }))
    if (input.pageRanges)
      form.append('pageRanges', input.pageRanges)
    const fileBytes = new Uint8Array(input.data.byteLength)
    fileBytes.set(input.data)
    form.append('file', new Blob([fileBytes.buffer], { type: input.contentType }), input.fileName)

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.request(`${this.baseUrl}${JOBS_PATH}`, {
          method: 'POST',
          headers: this.authHeaders(),
          body: form,
        })
        const data = await this.apiData(response)
        if (typeof data.jobId !== 'string' || !data.jobId)
          throw new PaddleOcrCloudError('invalid-response', 'PaddleOCR 提交结果缺少 jobId')
        return data.jobId
      }
      catch (error) {
        const delay = SUBMIT_RETRY_DELAYS_MS[attempt]
        if (!shouldRetrySubmit(error) || delay == null)
          throw error
        await this.sleep(delay)
      }
    }
  }

  private async poll(jobId: string, onProgress?: (percent: number) => void): Promise<string> {
    const startedAt = this.now()
    let interval = INITIAL_POLL_INTERVAL_MS

    while (true) {
      const elapsed = this.now() - startedAt
      if (elapsed >= this.pollTimeoutMs) {
        throw new PaddleOcrCloudError('poll-timeout', 'PaddleOCR 识别等待超时，可稍后重新识别', {
          retryable: true,
        })
      }

      const response = await this.request(`${this.baseUrl}${JOBS_PATH}/${encodeURIComponent(jobId)}`, {
        headers: this.authHeaders(),
      })
      const status = parseJobStatus(await this.apiData(response))
      const progress = jobProgress(status)
      if (progress != null)
        onProgress?.(progress)

      if (status.state === 'done') {
        const jsonUrl = status.resultUrl?.jsonUrl
        if (!jsonUrl)
          throw new PaddleOcrCloudError('invalid-response', 'PaddleOCR 完成任务缺少结果地址')
        onProgress?.(100)
        return jsonUrl
      }
      if (status.state === 'failed') {
        throw new PaddleOcrCloudError(
          'job-failed',
          `PaddleOCR 识别失败：${status.errorMsg || '未知原因'}`,
        )
      }

      const remaining = this.pollTimeoutMs - (this.now() - startedAt)
      if (remaining <= 0) {
        throw new PaddleOcrCloudError('poll-timeout', 'PaddleOCR 识别等待超时，可稍后重新识别', {
          retryable: true,
        })
      }
      await this.sleep(Math.min(interval, remaining))
      interval = Math.min(interval * POLL_INTERVAL_MULTIPLIER, MAX_POLL_INTERVAL_MS)
    }
  }

  private authHeaders(): HeadersInit {
    return { Authorization: `Bearer ${this.accessToken}` }
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await this.fetch(url, { ...init, signal: controller.signal })
      if (!response.ok) {
        const payload = await this.readApiPayload(response)
        throw errorForStatus(response.status, apiMessage(payload))
      }
      return response
    }
    catch (error) {
      if (error instanceof PaddleOcrCloudError)
        throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PaddleOcrCloudError('request-timeout', 'PaddleOCR 网络请求超时', {
          retryable: true,
          cause: error,
        })
      }
      throw new PaddleOcrCloudError('network', '无法连接 PaddleOCR 服务', {
        retryable: true,
        cause: error,
      })
    }
    finally {
      clearTimeout(timer)
    }
  }

  private async apiData(response: Response): Promise<Record<string, unknown>> {
    const payload = await this.readApiPayload(response)
    if (payload.code != null && payload.code !== 0)
      throw errorForStatus(payload.code, apiMessage(payload))
    if (!isRecord(payload.data))
      throw new PaddleOcrCloudError('invalid-response', 'PaddleOCR 响应缺少 data 对象')
    return payload.data
  }

  private async readApiPayload(response: Response): Promise<ApiPayload> {
    try {
      const payload = await response.json() as unknown
      if (!isRecord(payload))
        throw new TypeError('响应不是对象')
      return payload as ApiPayload
    }
    catch (error) {
      throw new PaddleOcrCloudError('invalid-response', 'PaddleOCR 响应不是合法 JSON', { cause: error })
    }
  }
}
