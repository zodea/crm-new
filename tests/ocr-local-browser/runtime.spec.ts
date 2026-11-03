import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })

test('本地模型识别合成图片，识别内容不发送到其他站点', async ({ page, baseURL }) => {
  test.setTimeout(180_000)
  const origin = new URL(baseURL!).origin
  const external: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin)
      external.push(url.origin)
  })
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 300
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#000'
    context.font = 'bold 92px "Microsoft YaHei"'
    context.fillText('发票号码 12345678', 70, 170)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法生成合成图片')), 'image/png'))
    const modulePath = '/_nuxt/lib/recognize/local-ocr.ts'
    const { recognizeLocalImage } = await import(/* @vite-ignore */ modulePath)
    const file = new File([blob], 'synthetic.png', { type: 'image/png' })
    const result = await recognizeLocalImage(file, '/')
    const invoicePath = '/_nuxt/lib/invoice/recognize.ts'
    const { recognizeInvoiceLocally } = await import(/* @vite-ignore */ invoicePath)
    const candidate = await recognizeInvoiceLocally({ file, basePath: '/' })
    return { words: result.items.map((item: { text: string }) => item.text), backend: result.runtime.requestedBackend, candidate }
  })
  expect(result.backend).toBe('wasm')
  expect(result.words.join(' ')).toMatch(/12345678/)
  expect(result.words.join(' ')).toMatch(/发票/)
  expect(result.candidate.fields.invoiceNumber).toBe('12345678')
  expect(result.candidate.fields.totalAmount).toBeNull()
  expect(result.candidate.requiresReview).toBe(true)
  expect(external).toEqual([])
})

test('按页渲染合成 PDF 并识别指定页', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Count 2 /Kids [4 0 R 6 0 R] >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ]
    for (const text of ['FIRST PAGE', 'INVOICE 123456']) {
      const stream = `BT /F1 48 Tf 30 100 Td (${text}) Tj ET`
      const streamId = objects.length + 2
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`)
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    }
    let data = '%PDF-1.4\n'
    const offsets = [0]
    for (const [index, object] of objects.entries()) {
      offsets.push(data.length)
      data += `${index + 1} 0 obj\n${object}\nendobj\n`
    }
    const xref = data.length
    data += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const pdfPath = '/_nuxt/lib/invoice/pdf-text.ts'
    const ocrPath = '/_nuxt/lib/recognize/local-ocr.ts'
    const { renderInvoicePdfPages } = await import(/* @vite-ignore */ pdfPath)
    const { recognizeLocalImage } = await import(/* @vite-ignore */ ocrPath)
    const pages: Array<{ index: number, text: string }> = []
    await renderInvoicePdfPages(new File([data], 'synthetic.pdf', { type: 'application/pdf' }), [1], async (index: number, image: File) => {
      const result = await recognizeLocalImage(image, '/')
      pages.push({ index, text: result.items.map((item: { text: string }) => item.text).join(' ') })
    })
    return pages
  })
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ index: 1, text: expect.stringMatching(/123456/) })
})

test('本机字符映射提取中文 PDF 文字', async ({ page }) => {
  await page.goto('/')
  const bytes = Array.from(readFileSync(new URL('./chinese-synthetic.pdf', import.meta.url)))
  const result = await page.evaluate(async (data) => {
    const modulePath = '/_nuxt/lib/invoice/pdf-text.ts'
    const { extractInvoicePdfText } = await import(/* @vite-ignore */ modulePath)
    return extractInvoicePdfText(new File([new Uint8Array(data)], 'chinese-synthetic.pdf', { type: 'application/pdf' }), '/')
  }, bytes)
  expect(result).toEqual({ pages: ['发票号码'], totalPages: 1 })
})
