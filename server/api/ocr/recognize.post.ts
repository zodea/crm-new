import type { PaddleOcrCloudErrorCode } from '../../utils/paddleocr-cloud'
import {
  PaddleOcrCloudClient,
  PaddleOcrCloudError,
} from '../../utils/paddleocr-cloud'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const RECOGNIZABLE_FILE_RE = /\.(?:pdf|png|jpe?g)$/i
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function responseStatus(code: PaddleOcrCloudErrorCode): number {
  if (code === 'invalid-request')
    return 400
  if (code === 'rate-limit')
    return 429
  if (code === 'request-timeout' || code === 'poll-timeout')
    return 504
  if (code === 'missing-token' || code === 'service-unavailable' || code === 'network')
    return 503
  return 502
}

function inferredContentType(fileName: string, multipartType?: string): string {
  if (multipartType && multipartType !== 'application/octet-stream')
    return multipartType
  const extension = fileName.split('.').at(-1)?.toLowerCase() || ''
  return CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream'
}

function optionalBoolean(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): boolean | undefined {
  const part = parts?.find(candidate => candidate.name === name)
  if (!part)
    return undefined
  const value = part.data.toString('utf8').trim().toLowerCase()
  if (value === 'true')
    return true
  if (value === 'false')
    return false
  throw createError({
    statusCode: 400,
    statusMessage: `Invalid ${name}`,
    data: { code: 'invalid-request', message: `${name} 必须是 true 或 false` },
  })
}

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename)

  if (!file?.filename) {
    throw createError({
      statusCode: 400,
      statusMessage: 'OCR upload requires a file',
      data: { code: 'invalid-request', message: '请选择要识别的 PDF 或图片' },
    })
  }
  if (!RECOGNIZABLE_FILE_RE.test(file.filename)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsupported OCR file type',
      data: { code: 'invalid-request', message: '仅支持 PDF、PNG、JPG、JPEG 文件' },
    })
  }
  if (file.data.byteLength > MAX_FILE_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'OCR file is too large',
      data: { code: 'invalid-request', message: '单个识别文件不能超过 20 MB' },
    })
  }

  const config = useRuntimeConfig(event)
  try {
    const client = new PaddleOcrCloudClient({
      accessToken: String(config.paddleOcrAccessToken || ''),
      baseUrl: String(config.paddleOcrBaseUrl || ''),
      requestTimeoutMs: positiveNumber(config.paddleOcrRequestTimeoutMs, 120_000),
      pollTimeoutMs: positiveNumber(config.paddleOcrPollTimeoutMs, 600_000),
    })
    return await client.recognize({
      fileName: file.filename,
      contentType: inferredContentType(file.filename, file.type),
      data: file.data,
      useDocOrientationClassify: optionalBoolean(parts, 'useDocOrientationClassify'),
    })
  }
  catch (error) {
    if (!(error instanceof PaddleOcrCloudError))
      throw error
    throw createError({
      statusCode: responseStatus(error.code),
      statusMessage: 'PaddleOCR recognition failed',
      data: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    })
  }
})
