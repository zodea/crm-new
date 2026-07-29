import { buildOcrRuntimeStatus } from '../../utils/ocr-runtime-options'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  return buildOcrRuntimeStatus({
    configured: Boolean(String(config.paddleOcrAccessToken || '').trim()),
    requestTimeoutMs: config.paddleOcrRequestTimeoutMs,
    pollTimeoutMs: config.paddleOcrPollTimeoutMs,
  })
})
