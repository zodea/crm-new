import { PADDLE_OCR_MODEL } from '../../utils/paddleocr-cloud'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  return {
    configured: Boolean(String(config.paddleOcrAccessToken || '').trim()),
    engine: 'paddleocr-official-api' as const,
    model: PADDLE_OCR_MODEL,
  }
})
