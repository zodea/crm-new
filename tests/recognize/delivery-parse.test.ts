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
  it('兼容 OCR 将手写日期识别为空格分隔的年月日', () => {
    const result = parseDeliveryMarkdown([`
      # 广州德力五金机电有限公司庆丰电线厂门市部送货单
      单号：0006477
      日期：2026 5 21
      <table>
        <tr><td>名称及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>电线</td><td>卷</td><td>1</td><td>100</td><td>100</td></tr>
      </table>
    `])

    expect(result.docs[0]?.date).toBe('2026-05-21')
  })

  it('数量存在但单价和金额缺失时提示缺失，不误报为金额计算不一致', () => {
    const result = parseDeliveryMarkdown([`
      # 佛山市智道建筑材料有限公司送货单
      单号：20260429001
      日期：2026年4月29日
      <table>
        <tr><td>名称及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>地面垫层砂浆#20</td><td>袋</td><td>10</td><td></td><td></td></tr>
        <tr><td>计：</td><td></td><td></td><td></td><td>0</td></tr>
      </table>
    `])
    const item = result.docs[0]?.items[0]

    expect(item?.note).toContain('单价缺失')
    expect(item?.note).toContain('金额缺失')
    expect(item?.note).not.toContain('金额与数量×单价不符')
    expect(result.docs[0]).toMatchObject({ balanced: false, statedTotal: 0 })
  })

  it('低置信待复核不等于金额不一致', () => {
    const result = parseDeliveryMarkdown([`
      # 广州德力五金机电有限公司庆丰电线厂门市部送货单
      单号：0006477
      <table>
        <tr><td>名称及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>无漆划划</td><td>1.49</td><td>183</td><td>4</td><td>732</td></tr>
        <tr><td>合计</td><td></td><td></td><td></td><td>732</td></tr>
      </table>
    `])
    const doc = result.docs[0]!

    expect(doc.items[0]?.note).toContain('低置信')
    expect(doc.note).not.toContain('金额与数量×单价不符')
    expect(doc).toMatchObject({ calculatedTotal: 732, statedTotal: 732, balanced: true })
  })

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

  it('产品编号不会抢占后续产品名称列', () => {
    const result = parseDeliveryMarkdown([`
      # 示例建材有限公司送货单
      <table>
        <tr><td>产品编号</td><td>产品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>SKU-001</td><td>干拌砌筑砂浆</td><td>吨</td><td>2.5</td><td>320</td><td>800</td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      expect.objectContaining({
        name: '干拌砌筑砂浆',
        unit: '吨',
        quantity: 2.5,
        unitPrice: 320,
        total: 800,
      }),
    ])
  })

  it('不把 name-only 的无数值行跨列拼入上一条材料规格', () => {
    const result = parseDeliveryMarkdown([`
      # 示例建材有限公司送货单
      <table>
        <tr><td>编号</td><td>产品</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>干拌抹灰砂浆</td><td>M10</td><td>吨</td><td>2</td><td>300</td><td>600</td></tr>
        <tr><td></td><td>页面边缘识别文字</td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      {
        name: '干拌抹灰砂浆',
        spec: 'M10',
        unit: '吨',
        quantity: 2,
        unitPrice: 300,
        total: 600,
        note: '',
      },
    ])
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

  it('按“品名及规格”组合表头对齐材料列，并保留仅有金额的待核行', () => {
    const result = parseDeliveryMarkdown([`
      # 示例送货单
      <table>
        <tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>钢筋甲 600长</td><td>条</td><td>12</td><td>8</td><td>96</td></tr>
        <tr><td>2</td><td>钢筋甲 250长</td><td>条</td><td>5</td><td>4</td><td>20</td></tr>
        <tr><td>3</td><td>植筋胶</td><td>支</td><td>3</td><td>17</td><td>51</td></tr>
        <tr><td>4</td><td>特殊费用（待核）</td><td></td><td></td><td></td><td>9</td></tr>
        <tr><td>合计</td><td></td><td></td><td></td><td></td><td>176</td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      expect.objectContaining({ name: '钢筋甲 600长', unit: '条', quantity: 12, unitPrice: 8, total: 96 }),
      expect.objectContaining({ name: '钢筋甲 250长', unit: '条', quantity: 5, unitPrice: 4, total: 20 }),
      expect.objectContaining({ name: '植筋胶', unit: '支', quantity: 3, unitPrice: 17, total: 51 }),
      expect.objectContaining({ name: '特殊费用（待核）', unit: '', quantity: null, unitPrice: null, total: 9 }),
    ])
    expect(result.docs[0]).toMatchObject({ statedTotal: 176, calculatedTotal: 176 })
  })

  it('材料名称包含“材料”等表头词时仍保留为有效明细', () => {
    const result = parseDeliveryMarkdown([`
      # 示例建材有限公司送货单
      <table>
        <tr><td>编号</td><td>产品</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>防水材料</td><td>桶</td><td>2</td><td>90</td><td>180</td></tr>
        <tr><td>2</td><td>成品保护材料</td><td>卷</td><td>3</td><td>20</td><td>60</td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      expect.objectContaining({ name: '防水材料', unit: '桶', quantity: 2, unitPrice: 90, total: 180 }),
      expect.objectContaining({ name: '成品保护材料', unit: '卷', quantity: 3, unitPrice: 20, total: 60 }),
    ])
  })

  it('费用凭证按服务项目与人民币金额解析，不把作业次数错当数量或单价', () => {
    const result = parseDeliveryMarkdown([`
      # 示例装卸经营部收款收据
      <table>
        <tr><td>客户名称</td><td>服务项目</td><td>工作时间</td><td>装卸车数</td><td>搬卸台数</td><td>人民币大写</td><td>备注</td></tr>
        <tr><td>示例客户</td><td>卸货服务费</td><td>2小时</td><td>2</td><td>1</td><td>615</td><td></td></tr>
      </table>
    `])
    const item = result.docs[0]?.items[0]

    expect(result.docs[0]?.supplier).toBe('示例装卸经营部')
    expect(item).toEqual({
      name: '卸货服务费',
      spec: '',
      unit: '',
      quantity: null,
      unitPrice: null,
      total: 615,
      note: '',
    })
  })

  it('同一销售单跨页时累加本页合计，不用后一页覆盖前一页', () => {
    const result = parseDeliveryMarkdown([
      `
        # 示例贸易有限公司销售单
        单号：SALE-20260717-001
        <table>
          <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
          <tr><td>1</td><td>水泥</td><td>袋</td><td>2</td><td>50</td><td>100</td></tr>
          <tr><td>本页合计</td><td></td><td></td><td></td><td></td><td>100</td></tr>
        </table>
      `,
      `
        # 示例贸易有限公司销售单
        单号：SALE-20260717-001
        <table>
          <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
          <tr><td>2</td><td>河砂</td><td>方</td><td>3</td><td>60</td><td>180</td></tr>
          <tr><td>本页合计</td><td></td><td></td><td></td><td></td><td>180</td></tr>
        </table>
      `,
    ])

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({
      statedTotal: 280,
      calculatedTotal: 280,
      balanced: true,
    })
    expect(result.docs[0]?.items).toHaveLength(2)
  })

  it('累计总计先出现时仍用本页金额核对当前页明细', () => {
    const result = parseDeliveryMarkdown([`
      # 示例贸易有限公司销售单
      <table>
        <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>水泥</td><td>袋</td><td>2</td><td>50</td><td>100</td></tr>
        <tr><td>累计总计</td><td></td><td></td><td></td><td></td><td>280</td></tr>
        <tr><td>本页金额</td><td></td><td></td><td></td><td></td><td>100</td></tr>
      </table>
    `])

    expect(result.docs[0]).toMatchObject({
      statedTotal: 100,
      calculatedTotal: 100,
      balanced: true,
    })
  })

  it('无法验证的字段式表单不走固定位置推断', () => {
    const result = parseDeliveryMarkdown([`
      # 示例经营部收据
      <table>
        <tr><td>客户名称</td><td>服务内容</td><td>工作时间</td><td>装卸车数</td><td>搬卸台数</td><td>大写</td><td>备注</td></tr>
        <tr><td>示例客户</td><td>现场服务</td><td>2小时</td><td>2</td><td>1</td><td>金额不可判定</td><td></td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([])
  })

  it('同一 OCR 页的独立表格即使单号相同也不自动合并', () => {
    const result = parseDeliveryMarkdown([`
      # 示例贸易有限公司销售单
      单号：SAME-PAGE-001
      <table>
        <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>水泥</td><td>袋</td><td>2</td><td>50</td><td>100</td></tr>
        <tr><td>合计</td><td></td><td></td><td></td><td></td><td>100</td></tr>
      </table>

      # 示例贸易有限公司销售单
      单号：SAME-PAGE-001
      <table>
        <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>河砂</td><td>方</td><td>3</td><td>60</td><td>180</td></tr>
        <tr><td>合计</td><td></td><td></td><td></td><td></td><td>180</td></tr>
      </table>
    `])

    expect(result.docs).toHaveLength(2)
    expect(result.docs.map(document => document.calculatedTotal)).toEqual([100, 180])
  })

  it('合计行同时含数量合计与金额时取最右侧金额', () => {
    const result = parseDeliveryMarkdown([`
      # 示例建材有限公司销售单
      <table>
        <tr><td>编号</td><td>产品</td><td>单位</td><td>总数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>轻钢龙骨</td><td>支</td><td>200</td><td>12.4075</td><td>2481.50</td></tr>
        <tr><td></td><td>合计</td><td>200</td><td>200</td><td></td><td>2481.50</td></tr>
      </table>
    `])

    expect(result.docs[0]).toMatchObject({ statedTotal: 2481.5, calculatedTotal: 2481.5 })
  })

  it('票面使用“计：”且金额为零时仍保留明确的零合计', () => {
    const result = parseDeliveryMarkdown([`
      # 示例砂浆有限公司送货单
      <table>
        <tr><td>编号</td><td>产品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额/元</td></tr>
        <tr><td>1</td><td>地面垫层砂浆#20</td><td>40KG/包</td><td>袋</td><td>10</td><td></td><td></td></tr>
        <tr><td>计：</td><td></td><td></td><td></td><td></td><td></td><td>¥0</td></tr>
      </table>
    `])

    expect(result.docs[0]).toMatchObject({ statedTotal: 0, calculatedTotal: 0 })
    expect(result.docs[0]?.items[0]?.name).toBe('地面垫层砂浆#20')
  })

  it('品名及规格列的无数值续行并入上一条规格', () => {
    const result = parseDeliveryMarkdown([`
      # 示例建材送货单
      <table>
        <tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>蓝色包装材料</td><td>米</td><td>201.6</td><td>13</td><td>2620</td></tr>
        <tr><td>2</td><td>2.4米×84件</td><td></td><td></td><td></td><td></td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      expect.objectContaining({
        name: '蓝色包装材料',
        spec: '2.4米×84件',
        total: 2620,
        note: expect.stringContaining('金额与数量×单价不符'),
      }),
    ])
  })

  it('组合名称规格表尾的说明、欠款与签收栏不污染最后一条规格', () => {
    const result = parseDeliveryMarkdown([`
      # 示例材料销售单
      <table>
        <tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>不锈钢膨胀栓</td><td>个</td><td>10</td><td>2</td><td>20</td></tr>
        <tr><td colspan="3">备注：项目现场</td><td colspan="3">收货：示例人员</td></tr>
        <tr><td colspan="2">说明：</td><td colspan="3">本单欠款：0</td></tr>
        <tr><td colspan="2">收货单位及经手人</td><td colspan="4">送货单位及经手人</td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      expect.objectContaining({ name: '不锈钢膨胀栓', spec: '', total: 20 }),
    ])
  })

  it('竖向字段式费用单从服务项目与人民币行提取金额', () => {
    const result = parseDeliveryMarkdown([`
      # 示例装卸搬运有限公司工作记录单
      <table>
        <tr><td>客户名称</td><td colspan="5"></td></tr>
        <tr><td>服务项目</td><td colspan="5">叉车费</td></tr>
        <tr><td colspan="6">卸砂浆4叉</td></tr>
        <tr><td>工作时间</td><td></td><td>台班数量</td><td></td><td>搬机台数</td><td></td></tr>
        <tr><td colspan="6">人名币（大写） 万 仟 壹 佰 拾 元 ¥：100元</td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      expect.objectContaining({ name: '叉车费', quantity: null, unitPrice: null, total: 100 }),
    ])
    expect(result.docs[0]).toMatchObject({
      supplier: '示例装卸搬运有限公司',
      statedTotal: 100,
      calculatedTotal: 100,
    })
  })

  it('字段式收据清除票头标识、拆分项目末尾金额并保留备注', () => {
    const result = parseDeliveryMarkdown([`
      # G7 示例装卸搬运有限公司收款收据
      NO 0003323
      2026年5月2日
      <table>
        <tr><td>客户名称</td><td colspan="5"></td></tr>
        <tr><td>服务项目</td><td colspan="5">叉车费 615</td></tr>
        <tr><td>工作时间</td><td></td><td>装卸车数</td><td></td><td>搬卸台数</td><td></td></tr>
        <tr><td colspan="6">人名币（大写）万仟陆佰壹拾伍元 ￥：615</td></tr>
        <tr><td colspan="6">备注：卸砖 41 板</td></tr>
      </table>
    `])

    expect(result.docs[0]).toMatchObject({
      supplier: '示例装卸搬运有限公司',
      orderNo: '0003323',
      date: '2026-05-02',
      statedTotal: 615,
      calculatedTotal: 615,
      balanced: true,
    })
    expect(result.docs[0]?.items).toEqual([{
      name: '叉车费',
      spec: '',
      unit: '',
      quantity: null,
      unitPrice: null,
      total: 615,
      note: '卸砖 41 板',
    }])
  })

  it('组合名称规格表中带有效单位但数值缺失的材料保持独立待核行', () => {
    const result = parseDeliveryMarkdown([`
      # 示例材料有限公司送货单
      <table>
        <tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>A材料</td><td>袋</td><td>2</td><td>10</td><td>20</td></tr>
        <tr><td>2</td><td>B材料</td><td>袋</td><td></td><td></td><td></td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toEqual([
      expect.objectContaining({ name: 'A材料', spec: '', quantity: 2, total: 20 }),
      expect.objectContaining({
        name: 'B材料',
        spec: '',
        unit: '袋',
        quantity: null,
        unitPrice: null,
        total: null,
        note: expect.stringContaining('低置信'),
      }),
    ])
  })

  it('同页相邻表格序号连续时合并为一张单并累加分页小计', () => {
    const result = parseDeliveryMarkdown([`
      # 示例文具商行销售单
      单号：XSD-CONTINUED-001
      <table>
        <tr><td>编号</td><td>商品名称</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>文件夹</td><td>2</td><td>10</td><td>20</td></tr>
        <tr><td>2</td><td>签字笔</td><td>5</td><td>2</td><td>10</td></tr>
        <tr><td colspan="4">小计：</td><td>30</td></tr>
      </table>
      送货人：店员
      # 示例文具商行销售单
      单号：XSD-CONTINUED-001
      <table>
        <tr><td>编号</td><td>商品名称</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>3</td><td>印台</td><td>2</td><td>8</td><td>16</td></tr>
        <tr><td colspan="4">小计：</td><td>16</td></tr>
      </table>
    `])

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({ statedTotal: 46, calculatedTotal: 46, balanced: true })
    expect(result.docs[0]?.items).toHaveLength(3)
  })

  it('无重复表头但序号延续的相邻表格接回上一张单', () => {
    const result = parseDeliveryMarkdown([`
      # 示例建材有限公司销售单
      单号：XS-CONTINUED-002
      <table>
        <tr><td>编号</td><td>产品</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>石膏板</td><td>张</td><td>10</td><td>20</td><td>200</td></tr>
        <tr><td>2</td><td>木方</td><td>扎</td><td>5</td><td>30</td><td>150</td></tr>
      </table>
      <table>
        <tr><td>3</td><td>铝梯</td><td>把</td><td>2</td><td>100</td><td>200</td></tr>
        <tr><td>合计</td><td></td><td></td><td></td><td></td><td>550</td></tr>
      </table>
    `])

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({ statedTotal: 550, calculatedTotal: 550, balanced: true })
    expect(result.docs[0]?.items).toHaveLength(3)
  })

  it('连续表前段小计、末段最终合计时只采用最终合计', () => {
    const result = parseDeliveryMarkdown([`
      # 示例材料有限公司销售单
      单号：CONTINUED-FINAL-001
      <table>
        <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>A材料</td><td>件</td><td>1</td><td>10</td><td>10</td></tr>
        <tr><td colspan="5">小计</td><td>10</td></tr>
      </table>
      <table>
        <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>2</td><td>B材料</td><td>件</td><td>1</td><td>20</td><td>20</td></tr>
        <tr><td colspan="5">合计</td><td>30</td></tr>
      </table>
    `])

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({ statedTotal: 30, calculatedTotal: 30, balanced: true })
  })

  it('识别“品名规格”表头并优先读取表内日期与单号', () => {
    const result = parseDeliveryMarkdown([`
      # 示例五金有限公司销售单
      <table>
        <tr><td colspan="3">客户名称：示例项目</td><td colspan="3">日期：2026-05-14</td><td colspan="2">NO：AK-20260514-001</td></tr>
        <tr><td>行号</td><td>品名规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td><td>出货仓库</td><td>备注</td></tr>
        <tr><td>1</td><td>不锈钢膨胀栓10*120</td><td>个</td><td>400</td><td>0.88</td><td>352</td><td>大仓库</td><td></td></tr>
        <tr><td>2</td><td>不锈钢膨胀栓8*80</td><td>个</td><td>8190</td><td>0.38</td><td>3112.2</td><td>大仓库</td><td></td></tr>
        <tr><td colspan="6">合计金额大写：叁仟肆佰陆拾肆元贰角</td><td>3464.20</td><td></td></tr>
      </table>
      2016.5.14
    `])

    expect(result.docs[0]).toMatchObject({
      date: '2026-05-14',
      orderNo: 'AK-20260514-001',
      statedTotal: 3464.2,
      calculatedTotal: 3464.2,
    })
    expect(result.docs[0]?.items).toHaveLength(2)
  })

  it('页码连续且单号仅少一个末位字符时合并，并沿用最近的累计总计', () => {
    const result = parseDeliveryMarkdown([
      `
        # 示例贸易有限公司销售单
        单号：XS202607170051
        第1页/共3页
        <table>
          <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
          <tr><td>1</td><td>水泥</td><td>袋</td><td>2</td><td>50</td><td>100</td></tr>
          <tr><td>页金额：100</td><td>总计金额：280</td></tr>
        </table>
      `,
      `
        # 示例贸易有限公司销售单
        单号：XS20260717005
        第2页/共3页
        <table>
          <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
          <tr><td>2</td><td>河砂</td><td>方</td><td>1</td><td>60</td><td>60</td></tr>
          <tr><td>总计金额：280</td></tr>
        </table>
      `,
      `
        # 示例贸易有限公司销售单
        单号：XS202607170051
        第3页/共3页
        <table>
          <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
          <tr><td>3</td><td>砖</td><td>块</td><td>12</td><td>10</td><td>120</td></tr>
        </table>
      `,
    ])

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({ statedTotal: 280, calculatedTotal: 280, balanced: true })
    expect(result.docs[0]?.items).toHaveLength(3)
  })

  it('相同打印页码的重复识别结果不并入同一跨页单据', () => {
    const page = (pageNumber: number, name: string) => `
      # 示例贸易有限公司销售单
      单号：DUPLICATED-PAGE-001
      日期：2026-07-17
      第${pageNumber}页/共2页
      <table>
        <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>${pageNumber}</td><td>${name}</td><td>件</td><td>1</td><td>10</td><td>10</td></tr>
      </table>
    `
    const result = parseDeliveryMarkdown([
      page(1, '第一页材料'),
      page(2, '第二页材料'),
      page(2, '重复第二页材料'),
    ])

    expect(result.docs).toHaveLength(2)
    expect(result.docs[0]?.items).toHaveLength(2)
    expect(result.docs[1]?.items).toHaveLength(1)
  })

  it('无显式单号的材料表不把商品条码当单号', () => {
    const result = parseDeliveryMarkdown([`
      # 示例文具商行销售单
      <table>
        <tr><td>编号</td><td>商品名称</td><td>数量</td><td>单价</td><td>金额</td><td>条码</td></tr>
        <tr><td>1</td><td>文件夹</td><td>2</td><td>10</td><td>20</td><td>6938702700314</td></tr>
      </table>
    `])

    expect(result.docs[0]?.orderNo).toBe('')
  })

  it('跨页单号相同但日期冲突时不合并独立单据', () => {
    const page = (date: string, name: string) => `
      # 示例贸易有限公司销售单
      单号：SAME-NUMBER-001
      日期：${date}
      <table>
        <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>1</td><td>${name}</td><td>袋</td><td>1</td><td>100</td><td>100</td></tr>
      </table>
    `
    const result = parseDeliveryMarkdown([
      page('2026-07-16', '水泥'),
      page('2026-07-17', '腻子粉'),
    ])

    expect(result.docs).toHaveLength(2)
  })

  it('跨页前页无页合计、末页只有普通合计时保留末页合计', () => {
    const result = parseDeliveryMarkdown([
      `
        # 示例贸易有限公司销售单
        单号：SALE-GENERIC-TOTAL-001
        <table>
          <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
          <tr><td>1</td><td>水泥</td><td>袋</td><td>2</td><td>50</td><td>100</td></tr>
        </table>
      `,
      `
        # 示例贸易有限公司销售单
        单号：SALE-GENERIC-TOTAL-001
        <table>
          <tr><td>序号</td><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
          <tr><td>2</td><td>河砂</td><td>方</td><td>3</td><td>60</td><td>180</td></tr>
          <tr><td>合计</td><td></td><td></td><td></td><td></td><td>280</td></tr>
        </table>
      `,
    ])

    expect(result.docs[0]).toMatchObject({ statedTotal: 280, calculatedTotal: 280, balanced: true })
  })

  it('裸“小计”行只作为汇总，不混入材料明细', () => {
    const result = parseDeliveryMarkdown([`
      # 示例材料销售单
      <table>
        <tr><td>商品名称</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
        <tr><td>水泥</td><td>袋</td><td>2</td><td>50</td><td>100</td></tr>
        <tr><td>小计</td><td>项</td><td>1</td><td>100</td><td>100</td></tr>
      </table>
    `])

    expect(result.docs[0]?.items).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({ statedTotal: 100, calculatedTotal: 100 })
  })
})
