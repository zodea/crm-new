import type { OcrResult } from '@paddleocr/paddleocr-js'
import { extractInvoicePdfText, renderInvoicePdfPages } from '~/lib/invoice/pdf-text'
import { parseInvoiceText } from '~/lib/recognize/invoice-parse'
import { recognizeLocalImage } from '~/lib/recognize/local-ocr'

/** 实际识别源的像素与多边形，仅供当前内存中的原图定位。 */
export interface LocalOcrGeometryPage {
  pageIndex: number
  width: number
  height: number
  source: 'image' | 'pdf-render'
  blocks: Array<{ text: string, polygon: Array<[number, number]> | null }>
}

async function imageFrame(file: File): Promise<{ width: number, height: number }> {
  // SDK 0.4.2 对 File 使用 createImageBitmap；预览则使用 HTMLImageElement。
  // 同尺寸不足以识别 EXIF 180° 或镜像，逐块核对两条解码路径的全部像素。
  const bitmap = await createImageBitmap(file)
  let url: string | undefined
  try {
    const { width, height } = bitmap
    if (!width || !height || width * height > 16_000_000)
      throw new Error('图片定位源尺寸不可核对')
    const image = new Image()
    url = URL.createObjectURL(file)
    image.src = url
    await image.decode()
    if (image.naturalWidth !== width || image.naturalHeight !== height)
      throw new Error('图片定位源方向或尺寸不一致')
    const bitmapCanvas = document.createElement('canvas')
    const imageCanvas = document.createElement('canvas')
    bitmapCanvas.width = imageCanvas.width = 256
    bitmapCanvas.height = imageCanvas.height = 256
    const bitmapContext = bitmapCanvas.getContext('2d', { willReadFrequently: true })
    const imageContext = imageCanvas.getContext('2d', { willReadFrequently: true })
    if (!bitmapContext || !imageContext)
      throw new Error('图片定位源无法核对')
    for (let y = 0; y < height; y += 256) {
      for (let x = 0; x < width; x += 256) {
        const tileWidth = Math.min(256, width - x)
        const tileHeight = Math.min(256, height - y)
        bitmapContext.clearRect(0, 0, 256, 256)
        imageContext.clearRect(0, 0, 256, 256)
        bitmapContext.drawImage(bitmap, x, y, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight)
        imageContext.drawImage(image, x, y, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight)
        const first = bitmapContext.getImageData(0, 0, tileWidth, tileHeight).data
        const second = imageContext.getImageData(0, 0, tileWidth, tileHeight).data
        if (first.some((value, index) => value !== second[index]))
          throw new Error('图片定位源方向或像素不一致')
      }
    }
    return { width: bitmap.width, height: bitmap.height }
  }
  finally {
    bitmap.close()
    if (url)
      URL.revokeObjectURL(url)
  }
}

function geometryPage(result: OcrResult, pageIndex: number, frame: { width: number, height: number } | undefined, source: LocalOcrGeometryPage['source']): LocalOcrGeometryPage | null {
  const { width, height } = result.image ?? {}
  if (!frame || !Number.isSafeInteger(pageIndex) || pageIndex < 0
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || frame.width !== width || frame.height !== height) {
    return null
  }
  const blocks = result.items.flatMap<LocalOcrGeometryPage['blocks'][number]>((item) => {
    if (typeof item.text !== 'string' || !item.text.trim())
      return []
    if (!Array.isArray(item.poly) || item.poly.length < 4 || item.poly.length > 100
      || item.poly.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value))
        || point[0]! < 0 || point[0]! > width || point[1]! < 0 || point[1]! > height)) {
      return [{ text: item.text, polygon: null }]
    }
    const xs = item.poly.map(point => point[0]!)
    const ys = item.poly.map(point => point[1]!)
    if (Math.min(...xs) === Math.max(...xs) || Math.min(...ys) === Math.max(...ys))
      return [{ text: item.text, polygon: null }]
    return [{ text: item.text, polygon: item.poly.map(point => [point[0]!, point[1]!] as [number, number]) }]
  })
  return blocks.some(block => block.polygon) ? { pageIndex, width, height, source, blocks } : null
}

/** OCR 的同一行可能由多个文本框组成，按图片坐标排列，保留行间边界。 */
export function localOcrText(result: OcrResult): string {
  const boxes = result.items.flatMap((item) => {
    const xs = item.poly.map(point => point[0])
    const ys = item.poly.map(point => point[1])
    if (!item.text.trim() || !xs.length || !ys.length || [...xs, ...ys].some(value => !Number.isFinite(value)))
      return []
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    if (bottom <= top)
      return []
    return [{ text: item.text.trim(), x: Math.min(...xs), center: (top + bottom) / 2, height: bottom - top }]
  }).sort((a, b) => a.center - b.center || a.x - b.x)
  const lines: Array<{ center: number, height: number, boxes: typeof boxes }> = []
  for (const box of boxes) {
    const line = lines.find(value => Math.abs(value.center - box.center) <= Math.min(value.height, box.height) / 2)
    if (line)
      line.boxes.push(box)
    else
      lines.push({ center: box.center, height: box.height, boxes: [box] })
  }
  return lines.map(line => line.boxes.sort((a, b) => a.x - b.x).map(box => box.text).join(' ')).join('\n')
}

function hasInvoiceSignal(text: string): boolean {
  const parsed = parseInvoiceText(text)
  return Boolean(parsed.invoiceNumber || parsed.buyer || parsed.seller || parsed.totalAmount != null || parsed.items.length)
}

interface LocalDocumentDependencies {
  extract: typeof extractInvoicePdfText
  render: typeof renderInvoicePdfPages
  recognize: typeof recognizeLocalImage
  imageFrame?: typeof imageFrame
}

/** 文字型 PDF 先本机提取；扫描页或无法提取有效票面文字的页再本机识别，不调用云服务。 */
export async function recognizeLocalInvoiceDocument(
  file: File,
  basePath: string,
  onProgress?: (percent: number) => void,
  dependencies: LocalDocumentDependencies = { extract: extractInvoicePdfText, render: renderInvoicePdfPages, recognize: recognizeLocalImage },
): Promise<{ pages: string[], unrecognizedPageIndexes: number[], geometryPages: LocalOcrGeometryPage[], unlocatedTexts?: string[] }> {
  onProgress?.(0)
  if (!/\.pdf$/i.test(file.name)) {
    const result = await dependencies.recognize(file, basePath)
    const text = localOcrText(result)
    const frame = await (dependencies.imageFrame ?? imageFrame)(file).catch(() => undefined)
    const geometry = geometryPage(result, 0, frame, 'image')
    onProgress?.(100)
    return { pages: [text], unrecognizedPageIndexes: text.trim() ? [] : [0], geometryPages: geometry ? [geometry] : [] }
  }
  const { pages, totalPages } = await dependencies.extract(file, basePath)
  if (pages.length !== totalPages || !pages.length)
    throw new Error('PDF 页面提取不完整')
  const result = [...pages]
  const scan = pages.flatMap((text, index) => hasInvoiceSignal(text) ? [] : [index])
  const unrecognizedPageIndexes: number[] = []
  const geometryPages: LocalOcrGeometryPage[] = []
  const unlocatedTexts: string[] = []
  const processed = new Set<number>()
  let done = 0
  if (scan.length) {
    await dependencies.render(file, scan, async (index, image, frame) => {
      if (!scan.includes(index) || processed.has(index))
        throw new Error('PDF 扫描页识别结果页码无效')
      processed.add(index)
      const recognized = await dependencies.recognize(image, basePath)
      const text = localOcrText(recognized)
      const geometry = geometryPage(recognized, index, frame, 'pdf-render')
      if (geometry)
        geometryPages.push(geometry)
      else
        unlocatedTexts.push(...recognized.items.flatMap(item => typeof item.text === 'string' && item.text.trim() ? [item.text] : []))
      if (text.trim())
        result[index] = text
      else
        unrecognizedPageIndexes.push(index)
      done++
      onProgress?.(Math.round(done * 99 / scan.length))
    }, basePath)
  }
  if (done !== scan.length)
    throw new Error('PDF 扫描页识别不完整')
  onProgress?.(100)
  return { pages: result, unrecognizedPageIndexes, geometryPages: geometryPages.sort((a, b) => a.pageIndex - b.pageIndex), ...(unlocatedTexts.length ? { unlocatedTexts } : {}) }
}
