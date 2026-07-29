import type { PaddleOcrCloudErrorCode } from '../../utils/paddleocr-cloud'
import {
  OCR_RUNTIME_OPTIONS_MAX_BYTES,
  OcrRuntimeOptionsValidationError,
  parseLegacyOcrBooleanOption,
  parseOcrRuntimeOptionsJson,
  resolveOcrRuntimeOptions,
} from '../../utils/ocr-runtime-options'
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
  const values = parts
    ?.filter(candidate => candidate.name === name)
    .map(part => part.data.toString('utf8')) ?? []
  return parseLegacyOcrBooleanOption(values, name)
}

function invalidOptions(message: string) {
  return createError({
    statusCode: 400,
    statusMessage: 'Invalid OCR runtime options',
    data: { code: 'invalid-request', message },
  })
}

function runtimeOptions(parts: Awaited<ReturnType<typeof readMultipartFormData>>) {
  const unexpectedPart = parts?.find(part =>
    part.name && part.name !== 'file' && part.name !== 'options' && part.name !== 'useDocOrientationClassify',
  )
  if (unexpectedPart?.name)
    throw invalidOptions(`不支持的 OCR 表单字段：${unexpectedPart.name}`)

  const optionsParts = parts?.filter(part => part.name === 'options') ?? []
  if (optionsParts.length > 1)
    throw invalidOptions('OCR 参数只能提交一次')
  if (optionsParts[0] && optionsParts[0].data.byteLength > OCR_RUNTIME_OPTIONS_MAX_BYTES)
    throw invalidOptions(`OCR 参数不能超过 ${OCR_RUNTIME_OPTIONS_MAX_BYTES} 字节`)

  try {
    const parsed = optionsParts[0]
      ? parseOcrRuntimeOptionsJson(optionsParts[0].data.toString('utf8'))
      : {}
    const legacyOrientation = optionalBoolean(parts, 'useDocOrientationClassify')
    if (legacyOrientation != null) {
      if (parsed.useDocOrientationClassify != null
        && parsed.useDocOrientationClassify !== legacyOrientation) {
        throw invalidOptions('方向分类参数存在冲突，请只提交 options JSON')
      }
      parsed.useDocOrientationClassify = legacyOrientation
    }
    return parsed
  }
  catch (error) {
    if (error instanceof OcrRuntimeOptionsValidationError)
      throw invalidOptions(error.message)
    throw error
  }
}

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const files = parts?.filter(part => part.name === 'file' && part.filename) ?? []
  const file = files[0]

  if (!file?.filename || files.length !== 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'OCR upload requires a file',
      data: { code: 'invalid-request', message: '请选择且只选择一个要识别的 PDF 或图片' },
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
  const resolvedOptions = resolveOcrRuntimeOptions(runtimeOptions(parts), {
    requestTimeoutMs: config.paddleOcrRequestTimeoutMs,
    pollTimeoutMs: config.paddleOcrPollTimeoutMs,
  })
  try {
    const client = new PaddleOcrCloudClient({
      accessToken: String(config.paddleOcrAccessToken || ''),
      baseUrl: String(config.paddleOcrBaseUrl || ''),
      requestTimeoutMs: resolvedOptions.requestTimeoutMs,
      pollTimeoutMs: resolvedOptions.pollTimeoutMs,
    })
    return await client.recognize({
      fileName: file.filename,
      contentType: inferredContentType(file.filename, file.type),
      data: file.data,
      options: resolvedOptions.documentOptions,
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
