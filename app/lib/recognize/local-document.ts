import type { OcrResult } from '@paddleocr/paddleocr-js'
import { extractInvoicePdfText, renderInvoicePdfPages } from '~/lib/invoice/pdf-text'
import { parseInvoiceText } from '~/lib/recognize/invoice-parse'
import { recognizeLocalImage } from '~/lib/recognize/local-ocr'

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
}

/** 文字型 PDF 先本机提取；扫描页或无法提取有效票面文字的页再本机识别，不调用云服务。 */
export async function recognizeLocalInvoiceDocument(
  file: File,
  basePath: string,
  onProgress?: (percent: number) => void,
  dependencies: LocalDocumentDependencies = { extract: extractInvoicePdfText, render: renderInvoicePdfPages, recognize: recognizeLocalImage },
): Promise<{ pages: string[], unrecognizedPageIndexes: number[] }> {
  onProgress?.(0)
  if (!/\.pdf$/i.test(file.name)) {
    const text = localOcrText(await dependencies.recognize(file, basePath))
    onProgress?.(100)
    return { pages: [text], unrecognizedPageIndexes: text.trim() ? [] : [0] }
  }
  const { pages, totalPages } = await dependencies.extract(file, basePath)
  if (pages.length !== totalPages || !pages.length)
    throw new Error('PDF 页面提取不完整')
  const result = [...pages]
  const scan = pages.flatMap((text, index) => hasInvoiceSignal(text) ? [] : [index])
  const unrecognizedPageIndexes: number[] = []
  let done = 0
  if (scan.length) {
    await dependencies.render(file, scan, async (index, image) => {
      const text = localOcrText(await dependencies.recognize(image, basePath))
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
  return { pages: result, unrecognizedPageIndexes }
}
