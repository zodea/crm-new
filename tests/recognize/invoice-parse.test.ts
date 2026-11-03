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

  it('票面合计与逐行明细冲突时保留冲突并降低金额置信度', () => {
    const result = parseInvoiceText(`
      # 电子发票（普通发票）
      <table>
        <tr><td>项目名称</td><td>规格型号</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td><td>税率</td><td>税额</td></tr>
        <tr><td>*示例材料*材料甲</td><td>A</td><td>件</td><td>2</td><td>50.00</td><td>100.00</td><td>9%</td><td>9.00</td></tr>
        <tr><td>*示例材料*材料乙</td><td>B</td><td>件</td><td>1</td><td>50.00</td><td>50.00</td><td>9%</td><td>4.50</td></tr>
        <tr><td>合 计</td><td></td><td></td><td></td><td></td><td>¥150.00</td><td></td><td>¥13.00</td></tr>
        <tr><td>价税合计（小写）</td><td colspan="7">¥163.50</td></tr>
      </table>
    `)
    const confidence = buildInvoiceFieldConfidence(result)

    expect(result).toMatchObject({
      amount: 150,
      taxAmount: 13.5,
      totalAmount: 163.5,
      balanced: false,
    })
    expect(confidence.amount).toBeLessThan(0.85)
    expect(confidence.taxAmount).toBeLessThan(0.85)
    expect(confidence.totalAmount).toBeLessThan(0.85)
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

  it('同一行的买卖方标签不进入公司名称', () => {
    const result = parseInvoiceText('购 销\n买 名称: 合成甲建设有限公司 售 名称: 合成乙材料有限公司\n开票日期：2026年05月23日')
    expect(result.buyer).toBe('合成甲建设有限公司')
    expect(result.seller).toBe('合成乙材料有限公司')
  })

  it('文字层每字重复时能恢复明确的买卖方，不把标签当成名称', () => {
    const result = parseInvoiceText('购 名称: 合合成成甲甲建建设设有有限限公公司司 销 名称: 合合成成乙乙材材料料有有限限公公司司\n开票日期：2026年04月11日')
    expect(result.buyer).toBe('合成甲建设有限公司')
    expect(result.seller).toBe('合成乙材料有限公司')
    const spaced = parseInvoiceText('买 名 称 : 合 合 成 成 甲 甲 建 建 设 设 有 有 限 限 公 公 司 司 售 名 称 : 合 合 成 成 乙 乙 材 材 料 料 有 有 限 限 公 公 司 司')
    expect(spaced.buyer).toBe('合成甲建设有限公司')
    expect(spaced.seller).toBe('合成乙材料有限公司')
    const reversed = parseInvoiceText('销 名称: 合合成成乙乙材材料料有有限限公公司司 购 名称: 合合成成甲甲建建设设有有限限公公司司')
    expect(reversed.buyer).toBe('合成甲建设有限公司')
    expect(reversed.seller).toBe('合成乙材料有限公司')
  })

  it('重复字证据不完整时不补造买卖方，真实重复字名称保持原样', () => {
    const incomplete = parseInvoiceText('购 名称: 合合成成甲甲建建设设有有限限公公司司')
    expect(incomplete.buyer).toBe('')
    expect(incomplete.seller).toBe('')
    const unlabelled = parseInvoiceText('名称: 合合成成甲甲建建设设有有限限公公司司\n名称: 合合成成乙乙材材料料有有限限公公司司')
    expect(unlabelled.buyer).toBe('')
    expect(unlabelled.seller).toBe('')
    const legitimate = parseInvoiceText('名称: 人人材料有限公司\n名称: 合成建材有限公司')
    expect(legitimate.buyer).toBe('人人材料有限公司')
    expect(legitimate.seller).toBe('合成建材有限公司')
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
