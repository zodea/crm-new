import { describe, expect, it } from 'vitest'
import {
  calculateLatestOfficialPriceChange,
  calculateOfficialMarketDeviation,
  classifyOfficialMaterialCategory,
  OFFICIAL_MATERIAL_CATEGORIES,
  officialMaterialPriceSeries,
  resolveOfficialMaterialIdentity,
} from '~/lib/material/official-price-source'
import {
  analyzeMaterialPrices,
  buildMaterialPriceCatalog,
  buildSupplierContractRows,
} from '~/lib/material/price-analysis'

const suppliers = [
  { id: 'supplier-a', name: '甲厂' },
  { id: 'supplier-b', name: '乙厂' },
  { id: 'supplier-c', name: '丙厂' },
]

const projects = [
  { id: 'project-a', name: '项目甲' },
  { id: 'project-b', name: '项目乙' },
]

function delivery(
  id: string,
  supplierId: string | null,
  deliveryDate: string,
  lines: Array<{
    id: string
    materialName: string
    spec: string
    unit: string
    unitPrice: number | null
  }>,
) {
  return {
    id,
    projectId: 'project-a',
    supplierId,
    orderNo: id.toUpperCase(),
    deliveryDate,
    archived: true,
    lines,
  }
}

describe('材料单价分析', () => {
  it('提供官方月刊十二大类，但只有核实过的编码规格单位才关联价格', () => {
    expect(OFFICIAL_MATERIAL_CATEGORIES).toHaveLength(12)
    expect(OFFICIAL_MATERIAL_CATEGORIES.map(category => category.name)).toContain('电线电缆')
    expect(classifyOfficialMaterialCategory({
      name: 'BV 电线',
      spec: '2.5 mm²',
    })).toMatchObject({
      id: 'wire-cable',
      order: 9,
    })
    expect(classifyOfficialMaterialCategory({
      name: '水泥',
      spec: 'P.O 42.5',
    }).id).toBe('cement-sand-products')
    expect(classifyOfficialMaterialCategory({
      name: '现场自定义材料',
      spec: '',
    }).id).toBe('uncategorized')

    expect(resolveOfficialMaterialIdentity({
      name: 'BV 电线',
      spec: '2.5 mm2',
      unit: '米',
    })).toMatchObject({
      materialCode: '280304800070120011',
      model: 'BV',
      spec: '2.5 mm²',
      sourceUnit: '千米',
      normalizedUnit: 'm',
    })
    expect(resolveOfficialMaterialIdentity({
      name: 'BVR 电线',
      spec: '2.5 mm²',
      unit: 'm',
    })).toBeNull()
    expect(resolveOfficialMaterialIdentity({
      name: '水泥',
      spec: 'P.O 42.5',
      unit: '吨',
    })).toBeNull()
  })

  it('使用官方原文中的 BV 2.5mm² 月度综合价并按米换算市场偏差', () => {
    const series = officialMaterialPriceSeries({
      name: 'BV 电线',
      spec: '2.5 mm²',
      unit: 'm',
    })

    expect(series?.points.map(point => point.sourcePrice)).toEqual([
      2055.03,
      2003.69,
      2005.52,
      2056.50,
      2046.92,
    ])
    expect(series?.points.map(point => point.price)).toEqual([
      2.05503,
      2.00369,
      2.00552,
      2.05650,
      2.04692,
    ])
    expect(series?.points.at(-1)?.sourceUrl).toBe(
      'https://zfcj.gz.gov.cn/attachment/8/8049/8049156/10904012.pdf',
    )

    const deviation = calculateOfficialMarketDeviation(2.8, series)
    expect(deviation).toMatchObject({
      marketPrice: 2.8,
      officialPrice: 2.04692,
    })
    expect(deviation?.amount).toBeCloseTo(0.75308, 5)
    expect(deviation?.rate).toBeCloseTo(0.75308 / 2.04692, 8)
    expect(calculateOfficialMarketDeviation(430, null)).toBeNull()

    const monthlyChange = calculateLatestOfficialPriceChange(series)
    expect(monthlyChange).toMatchObject({
      previousMonth: '2026-05',
      currentMonth: '2026-06',
    })
    expect(monthlyChange?.amount).toBeCloseTo(-0.00958, 5)
    expect(monthlyChange?.rate).toBeCloseTo(-0.00958 / 2.0565, 8)
    expect(calculateLatestOfficialPriceChange(null)).toBeNull()
  })

  it('只把已归档、已明确分供方且单价有效的材料行归一为价格事实', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('archived-1', 'supplier-a', '2026-05-01', [
        { id: 'line-1', materialName: 'BV 电线', spec: '2.5 mm²', unit: '米', unitPrice: 2.5 },
        { id: 'line-2', materialName: '运费', spec: '', unit: '车', unitPrice: 500 },
      ]),
      delivery('archived-2', 'supplier-b', '2026-05-03', [
        { id: 'line-3', materialName: ' BV　电线 ', spec: '2.5 mm2', unit: 'm', unitPrice: 2.7 },
      ]),
      delivery('missing-supplier', null, '2026-05-06', [
        { id: 'line-5', materialName: 'BV 电线', spec: '2.5 mm²', unit: '米', unitPrice: 2.3 },
      ]),
    ], suppliers, projects)

    expect(catalog).toHaveLength(1)
    expect(catalog[0]).toMatchObject({
      name: 'BV 电线',
      spec: '2.5 mm²',
      unit: 'm',
      category: {
        id: 'wire-cable',
        order: 9,
      },
      officialIdentity: {
        materialCode: '280304800070120011',
      },
    })
    expect(catalog[0]?.facts).toHaveLength(2)
    expect(catalog[0]?.officialPriceLookupKey).toContain('bv电线')
    expect(catalog[0]?.facts.map(fact => fact.deliveryRecordId)).toEqual(['archived-1', 'archived-2'])
  })

  it('同一厂家存在多个日期价格点时切换为趋势，并限制最多四条厂家线', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('a-1', 'supplier-a', '2026-04-01', [
        { id: 'line-a1', materialName: 'BV 电线', spec: '2.5', unit: 'm', unitPrice: 2.5 },
      ]),
      delivery('a-2', 'supplier-a', '2026-05-01', [
        { id: 'line-a2', materialName: 'BV 电线', spec: '2.5', unit: 'm', unitPrice: 2.8 },
      ]),
      delivery('b-1', 'supplier-b', '2026-05-02', [
        { id: 'line-b1', materialName: 'BV 电线', spec: '2.5', unit: 'm', unitPrice: 2.7 },
      ]),
      delivery('c-1', 'supplier-c', '2026-05-03', [
        { id: 'line-c1', materialName: 'BV 电线', spec: '2.5', unit: 'm', unitPrice: 2.6 },
      ]),
    ], suppliers, projects)

    const analysis = analyzeMaterialPrices(catalog[0]!, [
      'supplier-a',
      'supplier-b',
      'supplier-c',
      'supplier-d',
      'supplier-e',
    ])

    expect(analysis.mode).toBe('trend')
    expect(analysis.series).toHaveLength(3)
    expect(analysis.series[0]).toMatchObject({
      supplierId: 'supplier-a',
      supplierName: '甲厂',
    })
    expect(analysis.series[0]?.points.map(point => point.price)).toEqual([2.5, 2.8])
  })

  it('每家只有一个有效价格时展示最新价横向比较与最低价、中位数、价差', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('a-old', 'supplier-a', '2026-04-01', [
        { id: 'line-a1', materialName: '水泥', spec: 'P.O 42.5', unit: '吨', unitPrice: 410 },
      ]),
      delivery('b-new', 'supplier-b', '2026-05-01', [
        { id: 'line-b1', materialName: '水泥', spec: 'P.O 42.5', unit: '吨', unitPrice: 430 },
      ]),
      delivery('c-new', 'supplier-c', '2026-05-02', [
        { id: 'line-c1', materialName: '水泥', spec: 'P.O 42.5', unit: '吨', unitPrice: 450 },
      ]),
    ], suppliers, projects)

    const analysis = analyzeMaterialPrices(catalog[0]!)

    expect(analysis.mode).toBe('comparison')
    expect(analysis.comparisons.map(row => row.price)).toEqual([410, 430, 450])
    expect(analysis.lowestPrice).toBe(410)
    expect(analysis.medianPrice).toBe(430)
    expect(analysis.spread).toBe(40)
    expect(analysis.comparisons[0]?.isLowest).toBe(true)
  })

  it('按所选材料出现的厂家和项目汇总材采合同，并保留只读下钻所需合同明细', () => {
    const rows = buildSupplierContractRows(
      ['supplier-a', 'supplier-b'],
      [
        {
          id: 'contract-1',
          kind: '材采',
          supplierId: 'supplier-a',
          projectId: 'project-a',
          name: '电线采购合同一期',
          no: 'CG-001',
          amount: 100000,
          signDate: '2026-01-01',
        },
        {
          id: 'contract-2',
          kind: '材采',
          supplierId: 'supplier-a',
          projectId: 'project-a',
          name: '电线采购合同二期',
          no: 'CG-002',
          amount: 120000,
          signDate: '2026-03-01',
        },
        {
          id: 'contract-3',
          kind: '施工',
          supplierId: 'supplier-a',
          projectId: 'project-b',
          name: '不应出现',
          no: 'SG-001',
          amount: 500000,
          signDate: '2026-02-01',
        },
      ],
      suppliers,
      projects,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      supplierName: '甲厂',
      projectName: '项目甲',
      contractCount: 2,
      totalAmount: 220000,
    })
    expect(rows[0]?.contracts.map(contract => contract.name)).toEqual([
      '电线采购合同二期',
      '电线采购合同一期',
    ])
  })
})
