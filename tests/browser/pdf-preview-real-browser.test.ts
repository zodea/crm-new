import { expect, it } from 'vitest'
import { renderPdfPreviewPages } from '../../app/lib/invoice/pdf-preview'

function syntheticRotatedPdf() {
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

it('真实 pdf.js 渲染合成旋转页后交出可解码页图', async () => {
  expect(window.innerWidth).toBe(390)
  const result = await renderPdfPreviewPages(syntheticRotatedPdf())
  try {
    expect(result.totalPages).toBe(1)
    expect(result.pages).toHaveLength(1)
    const page = result.pages[0]!
    expect(page.pageIndex).toBe(0)
    expect([page.width, page.height]).toEqual([400, 600])
    const image = new Image()
    image.src = page.url
    await image.decode()
    expect([image.naturalWidth, image.naturalHeight]).toEqual([page.width, page.height])
  }
  finally {
    result.pages.forEach(page => URL.revokeObjectURL(page.url))
  }
})
