import { describe, expect, it, vi } from 'vitest'
import { recognizeInvoice } from '~/lib/invoice/recognize'

function jsonResponse(markdown: string): Response {
  return new Response(JSON.stringify({
    engine: 'paddleocr-official-api',
    model: 'PaddleOCR-VL-1.6',
    jobId: 'job_invoice_1',
    pages: [{
      pageIndex: 0,
      markdown,
      prunedResult: {},
      layoutRegions: [],
    }],
    markdownPages: [markdown],
    dataInfo: { numPages: 1 },
  }), {
    headers: { 'content-type': 'application/json' },
  })
}

const INVOICE_MARKDOWN = `
# 电子发票（普通发票）
发票号码：26442000000008248621
开票日期：2026年01月01日
购买方名称：广东瑞航建设工程有限公司
统一社会信用代码：91440101MA9RH00001
销售方名称：广州示例建材有限公司
统一社会信用代码：91440111MAE9TL102Q
<table>
  <tr><td>项目名称</td><td>规格型号</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td><td>税率</td><td>税额</td></tr>
  <tr><td>*水泥制品*普通硅酸盐水泥</td><td>P.O 42.5</td><td>袋</td><td>4</td><td>155.515</td><td>622.06</td><td>9%</td><td>55.98</td></tr>
</table>
合计 ¥622.06 ¥55.98
价税合计（小写）¥678.04
`

describe('recognizeInvoice', () => {
  it('用在线版面结果生成可进入发票校对工作台的完整字段', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(INVOICE_MARKDOWN))
    const progress: number[] = []
    const file = new File([new Uint8Array([7, 8, 9])], '真实发票.pdf', { type: 'application/pdf' })

    const result = await recognizeInvoice({ file }, {
      fetch: fetchMock,
      onProgress: value => progress.push(value),
    })

    expect(result).toMatchObject({
      invoiceType: '电子发票（普通发票）',
      invoiceNumber: '26442000000008248621',
      invoiceDate: '2026-01-01',
      buyer: '广东瑞航建设工程有限公司',
      seller: '广州示例建材有限公司',
      amount: 622.06,
      taxAmount: 55.98,
      totalAmount: 678.04,
      taxRate: '9%',
    })
    expect(result.items).toEqual([expect.objectContaining({
      name: '*水泥制品*普通硅酸盐水泥',
      quantity: 4,
      amount: 622.06,
    })])
    expect(result.fieldConfidence.invoiceNumber).toBeGreaterThanOrEqual(0.95)
    expect(result.ocrConfidence).toBeGreaterThan(0)
    expect(progress).toEqual([5, 100])

    const uploaded = (fetchMock.mock.calls[0]?.[1]?.body as FormData).get('file')
    expect(uploaded).toBe(file)
  })

  it('没有任何发票信号时明确失败，不把空白结果写成识别完成', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse('# 普通说明文档\n没有票据字段'))

    await expect(recognizeInvoice({ file: new File(['x'], 'not-invoice.png') }, {
      fetch: fetchMock,
    })).rejects.toMatchObject({
      code: 'invalid-result',
      message: '未从文件中识别出可用的发票字段',
    })
  })
})
