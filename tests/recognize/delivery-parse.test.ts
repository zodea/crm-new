import { describe, expect, it } from 'vitest'
import { parseDeliveryMarkdown } from '~/lib/recognize/delivery-parse'

const ROTATED_DELIVERY_MARKDOWN = `
# 广州示例供应链有限公司销售单
客户名称：广东瑞航建设工程有限公司
送货地址：合和新城项目部
单号：XFY-20260428-001
日期：2026.04.28
第1页/共5页
<table>
  <tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td><td>备注</td></tr>
  <tr><td>1</td><td>普通硅酸盐水泥</td><td>P.O 42.5</td><td>袋</td><td>4</td><td>155.50</td><td>622.00</td><td></td></tr>
  <tr><td>2</td><td>瓷砖</td><td>600×1200</td><td>片</td><td>10</td><td>20</td><td>200</td><td>优等品</td></tr>
  <tr><td colspan="3">大写：捌佰贰拾贰元整</td><td colspan="3">本页金额：¥822.00</td><td colspan="2">总计金额：¥1888.00</td></tr>
</table>
`

describe('parseDeliveryMarkdown', () => {
  it('解析旋转送货单的抬头、普通“单号”、日期、工地与 HTML 材料表', () => {
    const result = parseDeliveryMarkdown([ROTATED_DELIVERY_MARKDOWN])

    expect(result.supplier).toBe('广州示例供应链有限公司')
    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({
      supplier: '广州示例供应链有限公司',
      date: '2026-04-28',
      orderNo: 'XFY-20260428-001',
      siteText: '合和新城项目部',
      docType: '销售单',
      statedTotal: 822,
      calculatedTotal: 822,
      balanced: true,
    })
    expect(result.docs[0]?.items).toEqual([
      {
        name: '普通硅酸盐水泥',
        spec: 'P.O 42.5',
        unit: '袋',
        quantity: 4,
        unitPrice: 155.5,
        total: 622,
        note: '',
      },
      {
        name: '瓷砖',
        spec: '600×1200',
        unit: '片',
        quantity: 10,
        unitPrice: 20,
        total: 200,
        note: '优等品',
      },
    ])
  })

  it('兼容 Paddle HTML 的裸“产品”表头，不把编号当作材料名称', () => {
    const result = parseDeliveryMarkdown([`
      # 示例建材有限公司送货单
      <table>
        <tr><td>编号</td><td>产品</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>干拌砌筑砂浆</td><td>吨</td><td>2.5</td><td>320</td><td>800</td></tr>
      </table>
    `])

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]?.items).toEqual([
      {
        name: '干拌砌筑砂浆',
        spec: '',
        unit: '吨',
        quantity: 2.5,
        unitPrice: 320,
        total: 800,
        note: '',
      },
    ])
    expect(result.docs[0]?.items[0]?.name).not.toBe('1')
  })

  it('客户/地址不会覆盖供应商，合计与明细不符时明确标待复核', () => {
    const result = parseDeliveryMarkdown([ROTATED_DELIVERY_MARKDOWN
      .replace('822.00', '900.00')
      .replace('622.00', '600.00')])
    const doc = result.docs[0]!

    expect(doc.supplier).toBe('广州示例供应链有限公司')
    expect(doc.balanced).toBe(false)
    expect(doc.note).toContain('金额与数量×单价不符')
    expect(doc.note).toContain('合计')
  })

  it('兼容 Markdown 竖线表格，并按页面拆出多张送货单', () => {
    const result = parseDeliveryMarkdown([
      `
      # 佛山甲材料有限公司送货单
      送货单号：A-0001
      2026年5月2日
      | 序号 | 材料名称 | 规格型号 | 单位 | 数量 | 单价 | 金额 |
      | --- | --- | --- | --- | --- | --- | --- |
      | 1 | 中砂 | 细度2.6 | 方 | 10 | 80 | 800 |
      `,
      `
      # 东莞乙建材经营部出货单
      编号：B-0002
      2026/05/03
      | 品名 | 单位 | 数量 | 单价 | 总价 |
      | --- | --- | --- | --- | --- |
      | 碎石 | 吨 | 3 | 120 | 360 |
      `,
    ])

    expect(result.docs).toHaveLength(2)
    expect(result.docs.map(doc => [doc.supplier, doc.orderNo, doc.date])).toEqual([
      ['佛山甲材料有限公司', 'A-0001', '2026-05-02'],
      ['东莞乙建材经营部', 'B-0002', '2026-05-03'],
    ])
    expect(result.docs[0]?.items[0]).toMatchObject({ name: '中砂', spec: '细度2.6', total: 800 })
  })

  it('无表格时从纯文本材料行兜底，不把税号长串误当单号', () => {
    const result = parseDeliveryMarkdown([`
      广州示例建材有限公司送货单
      统一社会信用代码：91440101MA9RH00001
      日期 2026-06-08
      白水泥 袋 5 30 150
      搬运费 次 1 20 20
    `])
    const doc = result.docs[0]!

    expect(doc.orderNo).toBe('')
    expect(doc.items).toEqual([
      expect.objectContaining({ name: '白水泥', unit: '袋', quantity: 5, unitPrice: 30, total: 150 }),
      expect.objectContaining({ name: '搬运费', unit: '次', quantity: 1, unitPrice: 20, total: 20 }),
    ])
  })

  it('兼容“名称及规格”表头，并保留手写低置信行供人工改正', () => {
    const result = parseDeliveryMarkdown([`
      # 送货单 NO 7667928
      日期：2026年6月21日
      <table>
        <tr><td>货号 NO</td><td>名称及规格 Description</td><td>单位 Unit</td><td>数量 Quantity</td><td>单价 Unit Price</td><td>金额 Amount</td><td>备注</td></tr>
        <tr><td></td><td>7</td><td>12</td><td>150</td><td></td><td>10m</td><td></td></tr>
        <tr><td>合计 TOTAL</td><td>佰拾</td><td>万壹仟陆佰</td><td>拾</td><td>元 0.00</td><td>分</td><td>广州示例建材有限公司</td></tr>
        <tr><td>收货单位及经手人</td><td>送货单位及经手人</td></tr>
      </table>
    `])
    const doc = result.docs[0]!

    expect(result.supplier).toBe('广州示例建材有限公司')
    expect(doc.items).toEqual([
      expect.objectContaining({
        name: '7',
        unit: '12',
        quantity: 150,
        unitPrice: null,
        total: null,
        note: expect.stringContaining('低置信'),
      }),
    ])
  })
})
