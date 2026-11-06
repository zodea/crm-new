// 发票 PDF 逐页渲染为位图（工作台与编辑页的原图预览统一用它：浏览器内置 PDF 查看器无法叠加区域框，
// 也无法统一缩放/旋转）。只读预览：不改写原文件；页序与 OCR 页序一致（pageIndex = 页码 - 1）。
export interface PdfPreviewPage {
  pageIndex: number
  url: string
  width: number
  height: number
}

export interface PdfPreviewResult {
  pages: PdfPreviewPage[]
  /** 原文件总页数；大于 pages.length 时界面须如实提示未显示的页 */
  totalPages: number
}

const PREVIEW_SCALE = 2
/** 预览最多渲染的页数（每页 2 倍位图，防止大文件占满内存） */
export const MAX_PREVIEW_PAGES = 10

export async function renderPdfPreviewPages(file: File): Promise<PdfPreviewResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // 与识别预处理相同：经主线程 worker 入口，免去在 Nuxt/Tauri 中配置 workerSrc。
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pages: PdfPreviewPage[] = []
  let result: PdfPreviewResult | null = null
  let renderFailure: { error: unknown } | null = null
  try {
    const pdf = await loadingTask.promise
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PREVIEW_PAGES); pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: PREVIEW_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      // 渲染中途失败整体按失败处理，不返回缺页的半截结果
      if (!context)
        throw new Error('浏览器无法创建画布')
      await page.render({ canvas: null, canvasContext: context, viewport }).promise
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob)
        throw new Error('页面位图生成失败')
      pages.push({ pageIndex: pageNumber - 1, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height })
    }
    const totalPages = pdf.numPages
    await pdf.cleanup()
    result = { pages, totalPages }
  }
  catch (error) {
    renderFailure = { error }
    pages.forEach(page => URL.revokeObjectURL(page.url))
  }
  let destroyFailure: { error: unknown } | null = null
  try {
    await loadingTask.destroy()
  }
  catch (error) {
    destroyFailure = { error }
  }
  if (renderFailure || destroyFailure) {
    if (!renderFailure)
      pages.forEach(page => URL.revokeObjectURL(page.url))
    if (renderFailure && destroyFailure)
      throw new AggregateError([renderFailure.error, destroyFailure.error], 'PDF 渲染与资源清理均失败。')
    throw (renderFailure ?? destroyFailure)!.error
  }
  return result!
}
