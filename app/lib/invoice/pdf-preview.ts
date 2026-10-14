// 发票 PDF 逐页渲染为位图（原图叠加识别区域时使用；浏览器内置 PDF 查看器无法叠加框）。
// 只读预览：不改写原文件；页序与 OCR 页序一致（pageIndex = 页码 - 1）。
export interface PdfPreviewPage {
  pageIndex: number
  url: string
  width: number
  height: number
}

const PREVIEW_SCALE = 2
const MAX_PREVIEW_PAGES = 10

export async function renderPdfPreviewPages(file: File): Promise<PdfPreviewPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // 与识别预处理相同：经主线程 worker 入口，免去在 Nuxt/Tauri 中配置 workerSrc。
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pages: PdfPreviewPage[] = []
  try {
    const pdf = await loadingTask.promise
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PREVIEW_PAGES); pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: PREVIEW_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      if (!context)
        break
      await page.render({ canvas: null, canvasContext: context, viewport }).promise
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob)
        break
      pages.push({ pageIndex: pageNumber - 1, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height })
    }
    await pdf.cleanup()
    return pages
  }
  catch (error) {
    pages.forEach(page => URL.revokeObjectURL(page.url))
    throw error
  }
  finally {
    await loadingTask.destroy()
  }
}
