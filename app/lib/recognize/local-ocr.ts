import type { OcrResult, PaddleOCRCreateOptions } from '@paddleocr/paddleocr-js'

/** 模型与运行时只从当前站点加载，文档内容不发送到模型下载地址。 */
export function localOcrOptions(origin: string, basePath: string, fetcher: typeof fetch = globalThis.fetch): PaddleOCRCreateOptions {
  const base = new URL(basePath, origin)
  if (base.origin !== origin)
    throw new Error('本地 OCR 资源地址不属于当前站点')
  if (!base.pathname.endsWith('/') || base.search || base.hash)
    throw new Error('本地 OCR 基础路径无效')
  const model = (name: string) => new URL(`local-ocr/models/${name}`, base).href
  const detection = model('PP-OCRv6_small_det_onnx_infer.tar')
  const recognition = model('PP-OCRv6_small_rec_onnx_infer.tar')
  const allowed = new Set([detection, recognition])
  const localFetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, base)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (!allowed.has(url.href) || method.toUpperCase() !== 'GET')
      throw new Error('本地 OCR 拒绝非本机模型请求')
    return fetcher(input, { ...init, credentials: 'same-origin', redirect: 'error' })
  }
  return {
    textDetectionModelName: 'PP-OCRv6_small_det',
    textRecognitionModelName: 'PP-OCRv6_small_rec',
    textDetectionModelAsset: { url: detection },
    textRecognitionModelAsset: { url: recognition },
    ortOptions: { backend: 'wasm', wasmPaths: new URL('local-ocr/runtime/', base).href, numThreads: 1 },
    fetch: localFetch,
  }
}

/** 返回原始逐行文本和置信度；业务字段必须另行解析并人工核对。 */
export async function recognizeLocalImage(file: File, basePath: string): Promise<OcrResult> {
  const options = localOcrOptions(window.location.origin, basePath)
  const sdkUrl = new URL('local-ocr/runtime/paddleocr.js', new URL(basePath, window.location.origin)).href
  const { PaddleOCR } = await import(/* @vite-ignore */ sdkUrl) as typeof import('@paddleocr/paddleocr-js')
  const ocr = await PaddleOCR.create(options)
  try {
    const results = await ocr.predict(file)
    if (results.length !== 1 || !results[0])
      throw new Error('本地 OCR 没有返回完整的图片识别结果')
    return results[0]
  }
  finally { await ocr.dispose() }
}
