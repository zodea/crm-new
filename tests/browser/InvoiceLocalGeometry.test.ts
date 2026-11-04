import type { OcrResult } from '@paddleocr/paddleocr-js'
import { expect, it, vi } from 'vitest'
import { renderPdfPreviewPages } from '~/lib/invoice/pdf-preview'
import { extractInvoicePdfText, renderInvoicePdfPages } from '~/lib/invoice/pdf-text'
import { recognizeInvoiceLocally } from '~/lib/invoice/recognize'
import { recognizeLocalInvoiceDocument } from '~/lib/recognize/local-document'

function pdfWithRotatedPage() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Rotate 90 /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let data = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(data.length)
    data += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = data.length
  data += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new File([data], 'synthetic-rotated.pdf', { type: 'application/pdf' })
}

async function syntheticResult(file: File): Promise<OcrResult> {
  const image = await createImageBitmap(file)
  try {
    const { width, height } = image
    return {
      image: { width, height },
      items: [{ text: '发票号码：87654321', score: 1, poly: [[width / 4, height / 4], [width / 2, height / 4], [width / 2, height / 2], [width / 4, height / 2]] }],
      metrics: { detMs: 0, recMs: 0, totalMs: 0, detectedBoxes: 1, recognizedCount: 1 },
      runtime: { requestedBackend: 'wasm', detProvider: 'wasm', recProvider: 'wasm', webgpuAvailable: false },
    }
  }
  finally { image.close() }
}

async function jpegWithOrientation(orientation: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 8
  const context = canvas.getContext('2d')!
  context.fillStyle = '#f00000'
  context.fillRect(0, 0, 8, 8)
  context.fillStyle = '#00f000'
  context.fillRect(8, 0, 8, 8)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法创建合成 JPEG')), 'image/jpeg', 1))
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const exif = new Uint8Array([0xFF, 0xE1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0])
  return new File([bytes.slice(0, 2), exif, bytes.slice(2)], `synthetic-${orientation}.jpg`, { type: 'image/jpeg' })
}

it('浏览器解码 PNG 后保留实际像素框与预览帧尺寸', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 200
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法创建合成图片')), 'image/png'))
  const file = new File([blob], 'synthetic.png', { type: 'image/png' })
  const readDocument = (input: File, basePath: string) => recognizeLocalInvoiceDocument(input, basePath, undefined, { extract: vi.fn(), render: vi.fn(), recognize: syntheticResult })
  const candidate = await recognizeInvoiceLocally({ file, basePath: '/' }, { readDocument })
  expect(candidate.regionFrames).toEqual([{ pageIndex: 0, width: 300, height: 200, source: 'image' }])
  expect(candidate.fieldRegions?.invoiceNumber).toEqual({ pageIndex: 0, blockLabel: 'text', box: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 } })
})

it('jPEG EXIF 旋转和镜像以 OCR 与实际预览一致的解码像素为前提', async () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const file = await jpegWithOrientation(orientation)
    const bitmap = await createImageBitmap(file)
    const width = bitmap.width
    const height = bitmap.height
    expect([width, height]).toEqual(orientation >= 5 ? [8, 16] : [16, 8])
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const [red, green] = context.getImageData(1, 1, 1, 1).data
    if (orientation === 2 || orientation === 3)
      expect(green).toBeGreaterThan(red!)
    if (orientation === 1 || orientation === 4)
      expect(red).toBeGreaterThan(green!)
    const readDocument = (input: File, basePath: string) => recognizeLocalInvoiceDocument(input, basePath, undefined, { extract: vi.fn(), render: vi.fn(), recognize: syntheticResult })
    const candidate = await recognizeInvoiceLocally({ file, basePath: '/' }, { readDocument })
    expect(candidate.regionFrames).toEqual([{ pageIndex: 0, width, height, source: 'image' }])
    expect(candidate.fieldRegions?.invoiceNumber?.box).toEqual({ x: 0.25, y: 0.25, width: 0.25, height: 0.25 })
  }
})

it('即使解码尺寸相同，只要预览与 OCR 位图像素方向不一致就不定位', async () => {
  const file = await jpegWithOrientation(1)
  const recognized = await syntheticResult(file)
  const decode = globalThis.createImageBitmap.bind(globalThis)
  vi.stubGlobal('createImageBitmap', async (input: ImageBitmapSource) => {
    const original = await decode(input)
    const canvas = document.createElement('canvas')
    canvas.width = original.width
    canvas.height = original.height
    const context = canvas.getContext('2d')!
    context.translate(canvas.width, canvas.height)
    context.rotate(Math.PI)
    context.drawImage(original, 0, 0)
    original.close()
    return decode(canvas)
  })
  try {
    const result = await recognizeLocalInvoiceDocument(file, '/', undefined, { extract: vi.fn(), render: vi.fn(), recognize: vi.fn().mockResolvedValue(recognized) })
    expect(result.pages).toEqual(['发票号码：87654321'])
    expect(result.geometryPages).toEqual([])
  }
  finally { vi.unstubAllGlobals() }
})

it('浏览器画布不可读时保留识别文字并明确没有定位', async () => {
  const file = await jpegWithOrientation(1)
  const recognized = await syntheticResult(file)
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  try {
    const result = await recognizeLocalInvoiceDocument(file, '/', undefined, { extract: vi.fn(), render: vi.fn(), recognize: vi.fn().mockResolvedValue(recognized) })
    expect(result.pages).toEqual(['发票号码：87654321'])
    expect(result.geometryPages).toEqual([])
  }
  finally { context.mockRestore() }
})

it('旋转 PDF 的扫描帧与预览页使用相同页序、方向及长宽比', async () => {
  const file = pdfWithRotatedPage()
  const readDocument = (input: File, basePath: string) => recognizeLocalInvoiceDocument(input, basePath, undefined, { extract: extractInvoicePdfText, render: renderInvoicePdfPages, recognize: syntheticResult })
  const candidate = await recognizeInvoiceLocally({ file, basePath: '/' }, { readDocument })
  const preview = await renderPdfPreviewPages(file)
  try {
    expect(candidate.regionFrames).toEqual([{ pageIndex: 0, width: 400, height: 600, source: 'pdf-render' }])
    expect(candidate.fieldRegions?.invoiceNumber).toEqual({ pageIndex: 0, blockLabel: 'text', box: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 } })
    expect(preview.pages).toHaveLength(1)
    expect(preview.pages[0]).toMatchObject({ pageIndex: 0, width: 400, height: 600 })
  }
  finally { preview.pages.forEach(page => URL.revokeObjectURL(page.url)) }
})
