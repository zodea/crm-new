/** 将文字型 PDF 的文字位置按行排列；不把扫描图或缺失文字伪装成识别结果。 */
export interface PdfTextItem {
  str: string
  x: number
  y: number
}

export function groupPdfTextLines(items: readonly PdfTextItem[]): string[] {
  const lines: Array<{ y: number, items: PdfTextItem[] }> = []
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!item.str.trim() || !Number.isFinite(item.x) || !Number.isFinite(item.y))
      continue
    const line = lines.find(value => Math.abs(value.y - item.y) <= 3)
    if (line)
      line.items.push(item)
    else
      lines.push({ y: item.y, items: [item] })
  }
  return lines.map(line => line.items.sort((a, b) => a.x - b.x).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim())
}

export async function extractInvoicePdfText(file: File, basePath = '/'): Promise<{ pages: string[], totalPages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${basePath}pdfjs/cmaps/`,
    cMapPacked: true,
  })
  try {
    const pdf = await loading.promise
    if (pdf.numPages > 10)
      throw new Error('PDF 超过 10 页，请拆分后再提取文字')
    const pages: string[] = []
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      try {
        const content = await page.getTextContent()
        const items = content.items.flatMap(item => 'str' in item && Array.isArray(item.transform)
          ? [{ str: item.str, x: item.transform[4]!, y: item.transform[5]! }]
          : [])
        pages.push(groupPdfTextLines(items).join('\n'))
      }
      finally { page.cleanup() }
    }
    return { pages, totalPages: pdf.numPages }
  }
  finally { await loading.destroy() }
}

/** 扫描页逐页渲染并交给本机识别，限制画布尺寸且不保留整份 PDF 的图片。页码从 0 开始。 */
export async function renderInvoicePdfPages(
  file: File,
  pageIndexes: readonly number[],
  consume: (pageIndex: number, image: File, frame: { width: number, height: number }) => Promise<void>,
  basePath = '/',
): Promise<void> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${basePath}pdfjs/cmaps/`,
    cMapPacked: true,
  })
  try {
    const pdf = await loading.promise
    if (pdf.numPages > 10)
      throw new Error('PDF 超过 10 页，请拆分后再识别')
    if (new Set(pageIndexes).size !== pageIndexes.length || pageIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= pdf.numPages))
      throw new Error('PDF 页码无效')
    for (const pageIndex of pageIndexes) {
      const page = await pdf.getPage(pageIndex + 1)
      const canvas = document.createElement('canvas')
      try {
        const initial = page.getViewport({ scale: 1 })
        if (!Number.isFinite(initial.width) || !Number.isFinite(initial.height) || initial.width <= 0 || initial.height <= 0)
          throw new Error('PDF 页面尺寸无效')
        const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(initial.width, initial.height)) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport, background: 'white' }).promise
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法生成 PDF 页面图片')), 'image/png'))
        await consume(pageIndex, new File([blob], `page-${pageIndex + 1}.png`, { type: 'image/png' }), { width: canvas.width, height: canvas.height })
      }
      finally {
        canvas.width = 0
        canvas.height = 0
        page.cleanup()
      }
    }
  }
  finally { await loading.destroy() }
}
