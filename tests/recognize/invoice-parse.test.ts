import { describe, expect, it } from 'vitest'
import {
  buildInvoiceFieldConfidence,
  parseInvoiceText,
} from '~/lib/recognize/invoice-parse'

const ELECTRONIC_INVOICE_TEXT = `
电子发票（普通发票）
项目名称 规格型号 单位 数量 单价 金额 税率/征收率 税额
发票号码：
开票日期：
购买方信息
统一社会信用代码/纳税人识别号：
名称：
销售方信息
统一社会信用代码/纳税人识别号：
名称：
合计
价税合计（大写） （小写）
备注
26442000000008248621
2026年01月01日
广东瑞航建设工程有限公司 广州示例建材有限公司
91440101MA9RH00001 91440111MAE9TL102Q
*水泥制品*普通硅酸盐水泥 袋 4 155.515 622.06 9% 55.98
¥622.06 ¥55.98
陆佰柒拾捌圆零肆分 ¥678.04
`

describe('parseInvoiceText', () => {
  it('从电子发票错序文本恢复票号、日期、购销方、税号和价税勾稽', () => {
    const result = parseInvoiceText(ELECTRONIC_INVOICE_TEXT)

    expect(result).toMatchObject({
      invoiceType: '电子发票（普通发票）',
      invoiceNumber: '26442000000008248621',
      invoiceDate: '2026-01-01',
      buyer: '广东瑞航建设工程有限公司',
      buyerTaxNo: '91440101MA9RH00001',
      seller: '广州示例建材有限公司',
      sellerTaxNo: '91440111MAE9TL102Q',
      amount: 622.06,
      taxAmount: 55.98,
      totalAmount: 678.04,
      taxRate: '9%',
      balanced: true,
    })
  })

  it('解析 PaddleOCR-VL HTML 表格为发票明细行', () => {
    const result = parseInvoiceText(`
      # 电子发票（增值税专用发票）
      发票号码：25442000000123456789
      开票日期：2026年4月28日
      购买方名称：广东瑞航建设工程有限公司
      纳税人识别号：91440101MA9RH00001
      销售方名称：佛山示例贸易有限公司
      纳税人识别号：91440605MA8ABC1234
      <table>
        <tr><td>项目名称</td><td>规格型号</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td><td>税率</td><td>税额</td></tr>
        <tr><td>*建筑材料*瓷砖</td><td>600×1200</td><td>片</td><td>10</td><td>20.00</td><td>200.00</td><td>13%</td><td>26.00</td></tr>
        <tr><td>合 计</td><td></td><td></td><td></td><td></td><td>200.00</td><td></td><td>26.00</td></tr>
        <tr><td>价 税 合 计（小 写）</td><td></td><td></td><td></td><td></td><td>¥226.00</td><td></td><td></td></tr>
        <tr><td>备 注</td><td>项目名称：合和新城</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>
      价税合计（小写）：¥226.00
    `)

    expect(result.items).toEqual([{
      name: '*建筑材料*瓷砖',
      spec: '600×1200',
      unit: '片',
      quantity: 10,
      unitPrice: 20,
      amount: 200,
      taxRate: '13%',
      taxAmount: 26,
    }])
    expect(result).toMatchObject({
      amount: 200,
      taxAmount: 26,
      totalAmount: 226,
      taxRate: '13%',
      balanced: true,
    })
  })

  it('兼容字符间被 OCR 插入空格的票号、日期和金额', () => {
    const result = parseInvoiceText(`
      电 子 发 票（普 通 发 票）
      发 票 号 码：2 6 4 4 2 0 0 0 0 0 0 1 2 3 4 5 6 7 8 9
      开 票 日 期：2 0 2 6 年 0 3 月 0 9 日
      合 计 ¥ 1 0 0 . 0 0 ¥ 9 . 0 0
      价 税 合 计（小 写）¥ 1 0 9 . 0 0
    `)

    expect(result.invoiceNumber).toBe('26442000000123456789')
    expect(result.invoiceDate).toBe('2026-03-09')
    expect(result.amount).toBe(100)
    expect(result.taxAmount).toBe(9)
    expect(result.totalAmount).toBe(109)
  })

  it('字段缺失或价税不平时降置信，不伪造为已确认', () => {
    const result = parseInvoiceText('电子发票 发票号码：12345678 价税合计（小写）：¥100.00 税额：¥20.00')
    const confidence = buildInvoiceFieldConfidence(result)

    expect(result.balanced).toBe(false)
    expect(confidence.invoiceNumber).toBeGreaterThanOrEqual(0.95)
    expect(confidence.seller).toBeLessThan(0.85)
    expect(confidence.totalAmount).toBeLessThan(0.85)
  })

  it('从项目/工地标签保留原始项目提示，绑定规范项目留给领域层', () => {
    const result = parseInvoiceText(`${ELECTRONIC_INVOICE_TEXT}\n项目名称：合和新城更衣室装修工程`)
    expect(result.projectHint).toBe('合和新城更衣室装修工程')
  })
})
