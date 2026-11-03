import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { extractInvoicePdfText, groupPdfTextLines, renderInvoicePdfPages } from '~/lib/invoice/pdf-text'

/** 完整的合成 PDF，使用标准字体，不依赖真实票据或演示数据。 */
function syntheticPdf(pageContent: string[]) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageContent.length} /Kids [${pageContent.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (const [index, content] of pageContent.entries()) {
    const stream = `BT /F1 12 Tf 30 100 Td (${content}) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  let text = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text))
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new File([text], 'synthetic.pdf', { type: 'application/pdf' })
}

describe('文字型 PDF 提取', () => {
  it('按页面顺序读取完整文字，不访问云服务', async () => {
    const result = await extractInvoicePdfText(syntheticPdf(['Invoice Number: 12345678', 'Second Page']))
    expect(result).toEqual({ pages: ['Invoice Number: 12345678', 'Second Page'], totalPages: 2 })
  })

  it('保留扫描页的空文字，不把它当作识别成功', async () => {
    expect(await extractInvoicePdfText(syntheticPdf(['']))).toEqual({ pages: [''], totalPages: 1 })
  })

  it('超过十页时明确拒绝，不能只处理前十页', async () => {
    await expect(extractInvoicePdfText(syntheticPdf(Array.from({ length: 11 }).fill('Page') as string[]))).rejects.toThrow('PDF 超过 10 页')
  })

  it('扫描页渲染在处理前拒绝过多、重复或不存在的页', async () => {
    const consume = async () => {
      throw new Error('不应处理无效页面')
    }
    await expect(renderInvoicePdfPages(syntheticPdf(Array.from({ length: 11 }).fill('Page') as string[]), [0], consume)).rejects.toThrow('PDF 超过 10 页')
    await expect(renderInvoicePdfPages(syntheticPdf(['Page']), [0, 0], consume)).rejects.toThrow('PDF 页码无效')
    await expect(renderInvoicePdfPages(syntheticPdf(['Page']), [1], consume)).rejects.toThrow('PDF 页码无效')
  })

  it('按位置排序并分行，不把空文本或无效坐标当成文字', () => {
    expect(groupPdfTextLines([{ str: '乙', x: 35, y: 100 }, { str: '甲', x: 10, y: 101 }, { str: '下行', x: 5, y: 80 }, { str: '无效', x: Number.NaN, y: 100 }])).toEqual(['甲 乙', '下行'])
  })
})
