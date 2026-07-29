import { parseWireMaterialIdentity } from './wire-identity'

export interface OfficialMaterialCategory {
  id: string
  order: number
  name: string
}

export interface OfficialMaterialIdentity {
  sourceId: 'guangzhou-cost-station'
  categoryId: string
  categoryName: string
  materialCode: string
  materialName: string
  model: string
  cores: number
  sectionMm2: number
  spec: string
  sourceUnit: string
  normalizedUnit: string
  lookupKey: string
}

export interface OfficialMaterialPricePoint {
  id: string
  month: string
  date: string
  price: number
  sourcePrice: number
  sourceUnit: string
  normalizedUnit: string
  sourceUrl: string
}

export interface OfficialMaterialPriceSeries {
  identity: OfficialMaterialIdentity
  points: OfficialMaterialPricePoint[]
}

export interface OfficialMaterialMatchInput {
  name: string
  spec: string
  unit: string
}

export interface OfficialMarketDeviation {
  marketPrice: number
  officialPrice: number
  amount: number
  rate: number
}

export interface OfficialPriceMonthlyChange {
  previousMonth: string
  currentMonth: string
  amount: number
  rate: number
}

export interface OfficialMaterialPriceImportRow {
  sourceId: string
  category: string
  month: string
  materialCode: string
  materialName: string
  spec: string
  unit: string
  price: number
  lookupKey: string
  sourceUrl: string
}

export interface OfficialMaterialPriceImporter {
  importRows: (
    rows: readonly OfficialMaterialPriceImportRow[],
  ) => Promise<{ imported: number, rejected: number }>
}

/**
 * 广州市建设工程造价管理站月刊的十二个材料大类。
 *
 * 当前分类用于统一站内材料身份与筛选；只有建立了明确 code-spec-unit 映射的材料，
 * 才会关联官方价格事实，分类命中本身不会产生价格。
 */
export const OFFICIAL_MATERIAL_CATEGORIES: readonly OfficialMaterialCategory[] = [
  { id: 'metal', order: 1, name: '黑色及有色金属材料' },
  { id: 'cement-sand-products', order: 2, name: '水泥、砂石及混凝土制品' },
  { id: 'concrete-mortar', order: 3, name: '混凝土及砂浆' },
  { id: 'prefabricated-components', order: 4, name: '装配式预制构件' },
  { id: 'doors-windows', order: 5, name: '门窗及配件' },
  { id: 'finishes', order: 6, name: '装饰装修材料' },
  { id: 'glass', order: 7, name: '玻璃' },
  { id: 'pipes-fittings', order: 8, name: '管材及管件' },
  { id: 'wire-cable', order: 9, name: '电线电缆' },
  { id: 'electrical-routing', order: 10, name: '电气线路敷设材料' },
  { id: 'prefabricated-decoration', order: 11, name: '装配式装修材料' },
  { id: 'road-bridge', order: 12, name: '道路桥梁材料' },
] as const

export const UNCATEGORIZED_MATERIAL_CATEGORY: OfficialMaterialCategory = {
  id: 'uncategorized',
  order: 99,
  name: '待归类材料',
}

const CATEGORY_BY_ID = new Map(
  [...OFFICIAL_MATERIAL_CATEGORIES, UNCATEGORIZED_MATERIAL_CATEGORY]
    .map(category => [category.id, category]),
)

const CATEGORY_RULES: ReadonlyArray<{ id: string, pattern: RegExp }> = [
  { id: 'wire-cable', pattern: /\bBV[VR]?\b|YJV|VV22?|电线|电缆/i },
  { id: 'electrical-routing', pattern: /线槽|桥架|电缆桥架|母线槽|穿线管/ },
  { id: 'pipes-fittings', pattern: /给水管|排水管|管材|管件|阀门|弯头|三通/ },
  { id: 'glass', pattern: /玻璃/ },
  { id: 'doors-windows', pattern: /门|窗|五金配件/ },
  { id: 'concrete-mortar', pattern: /商品混凝土|预拌混凝土|砂浆/ },
  { id: 'cement-sand-products', pattern: /水泥|砂|碎石|砌块|砖/ },
  { id: 'prefabricated-components', pattern: /预制构件|叠合板|预制楼梯/ },
  { id: 'prefabricated-decoration', pattern: /装配式装修|集成墙板|整体卫浴/ },
  { id: 'road-bridge', pattern: /沥青|路缘石|桥梁|道路/ },
  { id: 'metal', pattern: /钢筋|螺纹钢|型钢|钢板|铝材|铜材/ },
  { id: 'finishes', pattern: /墙砖|地砖|瓷砖|石材|木地板|乳胶漆|涂料|腻子/ },
]

const BV_2_5_IDENTITY: OfficialMaterialIdentity = {
  sourceId: 'guangzhou-cost-station',
  categoryId: 'wire-cable',
  categoryName: '电线电缆',
  materialCode: '280304800070120011',
  materialName: '铜芯聚氯乙烯绝缘电线 BV',
  model: 'BV',
  cores: 1,
  sectionMm2: 2.5,
  spec: '1×2.5 mm²',
  sourceUnit: '千米',
  normalizedUnit: 'm',
  lookupKey: 'guangzhou-cost-station::280304800070120011::2.5mm²::m',
}

const BV_2_5_OFFICIAL_POINTS: readonly OfficialMaterialPricePoint[] = [
  {
    id: 'gz-bv-2.5-2026-02',
    month: '2026-02',
    date: '2026-02-01',
    sourcePrice: 2055.03,
    price: 2.05503,
    sourceUnit: '千米',
    normalizedUnit: 'm',
    sourceUrl: 'https://zfcj.gz.gov.cn/attachment/7/7988/7988736/10727184.pdf',
  },
  {
    id: 'gz-bv-2.5-2026-03',
    month: '2026-03',
    date: '2026-03-01',
    sourcePrice: 2003.69,
    price: 2.00369,
    sourceUnit: '千米',
    normalizedUnit: 'm',
    sourceUrl: 'https://zfcj.gz.gov.cn/attachment/8/8006/8006029/10774168.pdf',
  },
  {
    id: 'gz-bv-2.5-2026-04',
    month: '2026-04',
    date: '2026-04-01',
    sourcePrice: 2005.52,
    price: 2.00552,
    sourceUnit: '千米',
    normalizedUnit: 'm',
    sourceUrl: 'https://zfcj.gz.gov.cn/attachment/8/8022/8022857/10813087.pdf',
  },
  {
    id: 'gz-bv-2.5-2026-05',
    month: '2026-05',
    date: '2026-05-01',
    sourcePrice: 2056.50,
    price: 2.05650,
    sourceUnit: '千米',
    normalizedUnit: 'm',
    sourceUrl: 'https://zfcj.gz.gov.cn/attachment/8/8036/8036393/10857690.pdf',
  },
  {
    id: 'gz-bv-2.5-2026-06',
    month: '2026-06',
    date: '2026-06-01',
    sourcePrice: 2046.92,
    price: 2.04692,
    sourceUnit: '千米',
    normalizedUnit: 'm',
    sourceUrl: 'https://zfcj.gz.gov.cn/attachment/8/8049/8049156/10904012.pdf',
  },
]

export const GUANGZHOU_OFFICIAL_PRICE_SOURCE = {
  name: '广州市建设工程造价管理站价格信息',
  url: 'https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/jgxx/',
  status: 'available',
  priceBasis: '税前综合价（含原价、运杂费、运输损耗费及采购保管费）',
  disclaimer: '信息价是市场综合参考，不是政府定价；项目采购与结算仍应结合合同、品牌、交货条件和实际票据核对。',
} as const

function normalizeIdentityText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUnit(value: string): string {
  const unit = normalizeIdentityText(value).toLocaleLowerCase('zh-CN')
  if (['m', '米'].includes(unit))
    return 'm'
  if (['km', '千米', '公里'].includes(unit))
    return 'km'
  if (['㎡', 'm²', 'm2', '平方米', '平方'].includes(unit))
    return '㎡'
  if (['m³', 'm3', '立方米', '立方', '方'].includes(unit))
    return 'm³'
  if (['t', '吨'].includes(unit))
    return '吨'
  return unit
}

export function officialMaterialCategoryById(id: string): OfficialMaterialCategory {
  return CATEGORY_BY_ID.get(id) ?? UNCATEGORIZED_MATERIAL_CATEGORY
}

export function classifyOfficialMaterialCategory(
  material: Pick<OfficialMaterialMatchInput, 'name' | 'spec'>,
): OfficialMaterialCategory {
  const searchable = `${normalizeIdentityText(material.name)} ${normalizeIdentityText(material.spec)}`
  const matched = CATEGORY_RULES.find(rule => rule.pattern.test(searchable))
  return officialMaterialCategoryById(matched?.id ?? UNCATEGORIZED_MATERIAL_CATEGORY.id)
}

/**
 * 只对已核实的 code-spec-unit 建立映射；不得用大类或模糊名称猜测官方价格。
 */
export function resolveOfficialMaterialIdentity(
  material: OfficialMaterialMatchInput,
): OfficialMaterialIdentity | null {
  const wireIdentity = parseWireMaterialIdentity(material)
  const unit = normalizeUnit(material.unit)

  if (
    wireIdentity?.model === 'BV'
    && wireIdentity.cores === 1
    && wireIdentity.sectionMm2 === 2.5
    && unit === 'm'
  ) {
    return BV_2_5_IDENTITY
  }

  return null
}

export function officialMaterialPriceSeries(
  material: OfficialMaterialMatchInput,
): OfficialMaterialPriceSeries | null {
  const identity = resolveOfficialMaterialIdentity(material)
  if (!identity)
    return null

  return {
    identity,
    points: BV_2_5_OFFICIAL_POINTS.map(point => ({ ...point })),
  }
}

export function calculateOfficialMarketDeviation(
  marketPrice: number | null,
  series: OfficialMaterialPriceSeries | null,
): OfficialMarketDeviation | null {
  const officialPrice = series?.points.at(-1)?.price
  if (
    marketPrice == null
    || !Number.isFinite(marketPrice)
    || marketPrice <= 0
    || officialPrice == null
    || officialPrice <= 0
  ) {
    return null
  }

  const amount = marketPrice - officialPrice
  return {
    marketPrice,
    officialPrice,
    amount,
    rate: amount / officialPrice,
  }
}

export function calculateLatestOfficialPriceChange(
  series: OfficialMaterialPriceSeries | null,
): OfficialPriceMonthlyChange | null {
  if (!series || series.points.length < 2)
    return null

  const previous = series.points.at(-2)
  const current = series.points.at(-1)
  if (!previous || !current || previous.price <= 0)
    return null

  const amount = current.price - previous.price
  return {
    previousMonth: previous.month,
    currentMonth: current.month,
    amount,
    rate: amount / previous.price,
  }
}
