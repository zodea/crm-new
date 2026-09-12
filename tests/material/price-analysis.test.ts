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
import { parseWireMaterialIdentity } from '~/lib/material/wire-identity'

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
    amount?: number | null
    currentValueConfirmed?: boolean
  }>,
) {
  return {
    id,
    projectId: 'project-a',
    supplierId,
    orderNo: id.toUpperCase(),
    deliveryDate,
    archived: true,
    reviewStatus: 'reviewed' as const,
    ocrStatus: 'reviewed',
    naturalKeyDuplicate: false,
    currentValuesConfirmed: true,
    hasSourceFile: true,
    lines: lines.map(line => ({
      ...line,
      amount: line.amount === undefined
        ? (line.unitPrice == null ? null : 1)
        : line.amount,
      currentValueConfirmed: line.currentValueConfirmed ?? true,
    })),
  }
}

describe('材料单价分析', () => {
  it('缺原件的已核对中央记录保持归档，但不借有效价格进入分析', () => {
    const source = delivery('missing-original', 'supplier-a', '2026-09-11', [{ id: 'line', materialName: '水泥', spec: '', unit: '吨', unitPrice: 20, amount: 20 }])
    expect(buildMaterialPriceCatalog([{ ...source, dataOrigin: 'real', hasSourceFile: false }], suppliers, projects)).toEqual([])
    expect(buildMaterialPriceCatalog([{ ...source, dataOrigin: 'real', hasSourceFile: true }], suppliers, projects)[0]?.facts[0]?.price).toBe(20)
  })
  it('把 BV 全称、简称及常见单芯截面写法解析为同一稳定身份', () => {
    expect([
      parseWireMaterialIdentity({
        name: '铜芯聚氯乙烯绝缘电线',
        spec: '2.5',
      }),
      parseWireMaterialIdentity({
        name: 'BV 电线 2.5mm2',
        spec: '',
      }),
      parseWireMaterialIdentity({
        name: 'BV',
        spec: '1×2.5',
      }),
      parseWireMaterialIdentity({
        name: 'BV1*2.5',
        spec: '',
      }),
    ]).toEqual(Array.from({ length: 4 }, () => ({
      model: 'BV',
      cores: 1,
      sectionMm2: 2.5,
      key: 'wire::BV::1x2.5mm2',
      displayName: 'BV 电线',
      displaySpec: '1×2.5 mm²',
    })))
  })

  it('规格栏为空时可从名称中的 BV 与裸截面解析身份', () => {
    expect(parseWireMaterialIdentity({
      name: 'BV 2.5',
      spec: '',
    })).toEqual({
      model: 'BV',
      cores: 1,
      sectionMm2: 2.5,
      key: 'wire::BV::1x2.5mm2',
      displayName: 'BV 电线',
      displaySpec: '1×2.5 mm²',
    })
  })

  it('为 BVR 与 YJV 形成各自稳定身份，且不与同截面 BV 合并', () => {
    expect([
      parseWireMaterialIdentity({ name: 'BVR 软电线', spec: '1×2.5 mm²' }),
      parseWireMaterialIdentity({ name: '铜芯聚氯乙烯绝缘软电线', spec: '2.5' }),
    ]).toEqual(Array.from({ length: 2 }, () => ({
      model: 'BVR',
      cores: 1,
      sectionMm2: 2.5,
      key: 'wire::BVR::1x2.5mm2',
      displayName: 'BVR 电线',
      displaySpec: '1×2.5 mm²',
    })))

    expect(parseWireMaterialIdentity({
      name: 'YJV 铜芯交联聚乙烯绝缘电力电缆',
      spec: '3*2.5mm2',
    })).toEqual({
      model: 'YJV',
      cores: 3,
      sectionMm2: 2.5,
      key: 'wire::YJV::3x2.5mm2',
      displayName: 'YJV 电缆',
      displaySpec: '3×2.5 mm²',
    })
  })

  it('不把阻燃、耐火或铠装型号变体解析为普通 BV/YJV', () => {
    expect(parseWireMaterialIdentity({
      name: 'ZR-BV 电线',
      spec: '1×2.5 mm²',
    })).toBeNull()
    expect(parseWireMaterialIdentity({
      name: 'NH-BV 电线',
      spec: '2.5mm2',
    })).toBeNull()
    expect(parseWireMaterialIdentity({
      name: 'YJV22 电缆',
      spec: '4×25 mm²',
    })).toBeNull()
  })

  it('不把 YJV 复合截面规格截断后并入单一截面材料', () => {
    expect(parseWireMaterialIdentity({
      name: 'YJV 电缆',
      spec: '4×25+1×16 mm²',
    })).toBeNull()
  })

  it('材料目录按规范电线身份归并别名，同时隔离不同型号', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('bv-full-name', 'supplier-a', '2026-04-01', [
        {
          id: 'line-bv-full',
          materialName: '铜芯聚氯乙烯绝缘电线',
          spec: '2.5',
          unit: '米',
          unitPrice: 2.5,
        },
      ]),
      delivery('bv-short-name', 'supplier-a', '2026-05-01', [
        {
          id: 'line-bv-short',
          materialName: 'BV1*2.5',
          spec: '',
          unit: 'm',
          unitPrice: 2.8,
        },
      ]),
      delivery('bvr', 'supplier-b', '2026-05-02', [
        {
          id: 'line-bvr',
          materialName: 'BVR 电线',
          spec: '1×2.5 mm²',
          unit: '米',
          unitPrice: 3.1,
        },
      ]),
    ], suppliers, projects)

    expect(catalog).toHaveLength(2)
    expect(catalog.find(material => material.name === 'BV 电线')).toMatchObject({
      key: 'wire::BV::1x2.5mm2::m',
      name: 'BV 电线',
      spec: '1×2.5 mm²',
      unit: 'm',
      facts: [
        { deliveryRecordId: 'bv-full-name', price: 2.5 },
        { deliveryRecordId: 'bv-short-name', price: 2.8 },
      ],
    })
    expect(catalog.find(material => material.name === 'BVR 电线')).toMatchObject({
      key: 'wire::BVR::1x2.5mm2::m',
      facts: [{ deliveryRecordId: 'bvr', price: 3.1 }],
    })
  })

  it('型号变体在目录中保持独立，且不关联普通 BV 官方价格', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('bv', 'supplier-a', '2026-05-01', [{
        id: 'line-bv',
        materialName: 'BV 电线',
        spec: '1×2.5 mm²',
        unit: 'm',
        unitPrice: 2.5,
      }]),
      delivery('zr-bv', 'supplier-a', '2026-05-02', [{
        id: 'line-zr-bv',
        materialName: 'ZR-BV 电线',
        spec: '1×2.5 mm²',
        unit: 'm',
        unitPrice: 2.8,
      }]),
      delivery('nh-bv', 'supplier-b', '2026-05-03', [{
        id: 'line-nh-bv',
        materialName: 'NH-BV 电线',
        spec: '2.5mm2',
        unit: 'm',
        unitPrice: 3,
      }]),
      delivery('yjv', 'supplier-b', '2026-05-04', [{
        id: 'line-yjv',
        materialName: 'YJV 电缆',
        spec: '4×25 mm²',
        unit: 'm',
        unitPrice: 80,
      }]),
      delivery('yjv22', 'supplier-b', '2026-05-05', [{
        id: 'line-yjv22',
        materialName: 'YJV22 电缆',
        spec: '4×25 mm²',
        unit: 'm',
        unitPrice: 90,
      }]),
      delivery('yjv-composite', 'supplier-b', '2026-05-06', [{
        id: 'line-yjv-composite',
        materialName: 'YJV 电缆',
        spec: '4×25+1×16 mm²',
        unit: 'm',
        unitPrice: 100,
      }]),
    ], suppliers, projects)

    expect(catalog).toHaveLength(6)
    expect(catalog.find(material => material.name === 'BV 电线')?.officialIdentity)
      .toMatchObject({ materialCode: '280304800070120011' })
    for (const variantName of ['ZR-BV 电线', 'NH-BV 电线', 'YJV22 电缆']) {
      expect(catalog.find(material => material.name === variantName)?.officialIdentity)
        .toBeNull()
    }
    expect(catalog.find(material => material.name === 'YJV 电缆')?.key)
      .not
      .toBe(catalog.find(material => material.name === 'YJV22 电缆')?.key)
    expect(catalog.find(material => material.spec === '4×25+1×16 mm²')?.key)
      .not
      .toBe(catalog.find(material => material.spec === '4×25 mm²')?.key)
  })

  it('米与 m、千米与 km 分别归并，但不跨量级合并或改价', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('meter-cn', 'supplier-a', '2026-04-01', [{
        id: 'line-meter-cn',
        materialName: 'BV 电线',
        spec: '2.5mm2',
        unit: '米',
        unitPrice: 2.5,
      }]),
      delivery('meter-en', 'supplier-b', '2026-04-02', [{
        id: 'line-meter-en',
        materialName: '铜芯聚氯乙烯绝缘电线',
        spec: '1×2.5',
        unit: 'm',
        unitPrice: 2.6,
      }]),
      delivery('kilometer', 'supplier-c', '2026-04-03', [{
        id: 'line-kilometer',
        materialName: 'BV1*2.5',
        spec: '',
        unit: '千米',
        unitPrice: 2500,
      }]),
      delivery('kilometer-en', 'supplier-a', '2026-04-04', [{
        id: 'line-kilometer-en',
        materialName: 'BV 电线',
        spec: '1×2.5 mm²',
        unit: 'km',
        unitPrice: 2600,
      }]),
    ], suppliers, projects)

    expect(catalog).toHaveLength(2)
    expect(catalog.find(material => material.unit === 'm')?.facts).toHaveLength(2)
    expect(catalog.find(material => material.unit === 'km')).toMatchObject({
      key: 'wire::BV::1x2.5mm2::km',
      facts: [
        { price: 2500 },
        { price: 2600 },
      ],
    })
  })

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
      cores: 1,
      sectionMm2: 2.5,
      spec: '1×2.5 mm²',
      sourceUnit: '千米',
      normalizedUnit: 'm',
    })
    expect(resolveOfficialMaterialIdentity({
      name: 'BVR 电线',
      spec: '2.5 mm²',
      unit: 'm',
    })).toBeNull()
    expect(resolveOfficialMaterialIdentity({
      name: 'BV 电线',
      spec: '1×4 mm²',
      unit: 'm',
    })).toBeNull()
    expect(resolveOfficialMaterialIdentity({
      name: 'YJV 电缆',
      spec: '1×2.5 mm²',
      unit: 'm',
    })).toBeNull()
    expect(resolveOfficialMaterialIdentity({
      name: 'BV 电线',
      spec: '1×2.5 mm²',
      unit: '千米',
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
      spec: '1×2.5 mm²',
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
    expect(catalog[0]?.officialPriceLookupKey).toBe('wire::BV::1x2.5mm2::m')
    expect(catalog[0]?.facts.map(fact => fact.deliveryRecordId)).toEqual(['archived-1', 'archived-2'])
  })

  it('价格待补录的已归档明细不进入价格分析', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('price-pending', 'supplier-a', '2026-05-07', [{
        id: 'line-price-pending',
        materialName: 'BV 电线',
        spec: '2.5 mm²',
        unit: '米',
        unitPrice: null,
      }]),
    ], suppliers, projects)

    expect(catalog).toEqual([])
  })

  it('已有有效单价但金额待补录的明细仍不进入价格分析', () => {
    const catalog = buildMaterialPriceCatalog([
      delivery('amount-pending', 'supplier-a', '2026-05-08', [{
        id: 'line-amount-pending',
        materialName: 'BV 电线',
        spec: '2.5 mm²',
        unit: '米',
        unitPrice: 2.8,
        amount: null,
      }]),
    ], suppliers, projects)

    expect(catalog).toEqual([])
  })

  it('无单号但金额、单价和人工确认态完整的归档明细可进入价格目录', () => {
    const catalog = buildMaterialPriceCatalog([{
      ...delivery('no-order-number', 'supplier-a', '2026-05-09', [{
        id: 'line-no-order-number',
        materialName: 'BV 电线',
        spec: '2.5 mm²',
        unit: '米',
        unitPrice: 2.8,
        amount: 28,
      }]),
      orderNo: '',
    }], suppliers, projects)

    expect(catalog).toHaveLength(1)
    expect(catalog[0]?.facts).toEqual([
      expect.objectContaining({
        deliveryRecordId: 'no-order-number',
        deliveryOrderNo: 'no-order-number',
        price: 2.8,
      }),
    ])
  })

  it('#257 价格分析只读取人工确认后的当前单价，并保留原始/修订来源留痕', () => {
    const catalog = buildMaterialPriceCatalog([
      {
        ...delivery('confirmed', 'supplier-a', '2026-05-01', [{
          id: 'line-confirmed',
          materialName: 'BV 电线',
          spec: '2.5',
          unit: 'm',
          unitPrice: 2.8,
          currentValueConfirmed: true,
          originalOcrUnitPrice: 2.6,
          revisionReason: '人工核对票面单价',
        }]),
        reviewStatus: 'reviewed',
        ocrStatus: 'done',
      },
      {
        ...delivery('unreviewed', 'supplier-a', '2026-05-02', [{
          id: 'line-unreviewed',
          materialName: 'BV 电线',
          spec: '2.5',
          unit: 'm',
          unitPrice: 99,
        }]),
        reviewStatus: 'unreviewed',
      },
      {
        ...delivery('duplicate', 'supplier-a', '2026-05-03', [{
          id: 'line-duplicate',
          materialName: 'BV 电线',
          spec: '2.5',
          unit: 'm',
          unitPrice: 100,
        }]),
        naturalKeyDuplicate: true,
      },
      {
        ...delivery('line-unconfirmed', 'supplier-a', '2026-05-04', [{
          id: 'line-unconfirmed',
          materialName: 'BV 电线',
          spec: '2.5',
          unit: 'm',
          unitPrice: 101,
          currentValueConfirmed: false,
        }]),
        currentValuesConfirmed: false,
      },
    ], suppliers, projects)

    expect(catalog).toHaveLength(1)
    expect(catalog[0]?.facts).toMatchObject([{
      price: 2.8,
      provenance: {
        sourceKind: 'delivery',
        sourceRecordId: 'confirmed',
        sourceLineId: 'line-confirmed',
        originalOcrUnitPrice: 2.6,
        revisionReason: '人工核对票面单价',
      },
    }])
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
