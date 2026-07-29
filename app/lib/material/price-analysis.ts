import type {
  OfficialMaterialCategory,
  OfficialMaterialIdentity,
} from './official-price-source'
import {
  classifyOfficialMaterialCategory,
  resolveOfficialMaterialIdentity,
} from './official-price-source'

export interface DeliveryPriceLineInput {
  id: string
  materialName: string
  spec: string
  unit: string
  unitPrice: number | null
}

export interface DeliveryPriceRecordInput {
  id: string
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  archived: boolean
  lines: readonly DeliveryPriceLineInput[]
}

export interface PricePartyInput {
  id: string
  name: string
}

export interface MaterialPriceFact {
  id: string
  deliveryRecordId: string
  deliveryOrderNo: string
  date: string
  projectId: string
  projectName: string
  supplierId: string
  supplierName: string
  price: number
}

export interface MaterialPriceCatalogItem {
  key: string
  /** 稳定的“名称+规格+单位”归一键，供后续官方信息价事实源做只读匹配。 */
  officialPriceLookupKey: string
  /** 官方月刊大类；分类只用于检索，不代表已有官方价格。 */
  category: OfficialMaterialCategory
  /** 仅在 code-spec-unit 已人工核实时存在。 */
  officialIdentity: OfficialMaterialIdentity | null
  name: string
  spec: string
  unit: string
  label: string
  searchText: string
  facts: MaterialPriceFact[]
}

export interface MaterialPriceSeries {
  supplierId: string
  supplierName: string
  points: MaterialPriceFact[]
}

export interface MaterialPriceComparison extends MaterialPriceFact {
  isLowest: boolean
}

export interface MaterialPriceAnalysis {
  mode: 'trend' | 'comparison'
  supplierIds: string[]
  series: MaterialPriceSeries[]
  comparisons: MaterialPriceComparison[]
  lowestPrice: number | null
  medianPrice: number | null
  spread: number | null
}

export interface MaterialContractInput {
  id: string
  kind: string
  supplierId: string | null
  projectId: string
  name: string
  no: string
  amount: number
  signDate: string
}

export interface SupplierContractDetail {
  id: string
  name: string
  no: string
  amount: number
  signDate: string
}

export interface SupplierContractRow {
  key: string
  supplierId: string
  supplierName: string
  projectId: string
  projectName: string
  contractCount: number
  totalAmount: number
  contracts: SupplierContractDetail[]
}

const NON_MATERIAL_CHARGE = /运费|运输费|搬运费|上楼费|装卸费|吊装费/

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function identityText(value: string): string {
  return normalizeText(value)
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, '')
    .replace(/m2/g, 'm²')
    .replace(/m3/g, 'm³')
}

function normalizeMaterialSpec(value: string): string {
  return normalizeText(value)
    .replace(/m2\b/gi, 'm²')
    .replace(/m3\b/gi, 'm³')
}

export function normalizeMaterialUnit(value: string): string {
  const unit = identityText(value)
  if (['m', '米'].includes(unit))
    return 'm'
  if (['m²', '㎡', '平方米', '平方'].includes(unit))
    return '㎡'
  if (['m³', '立方米', '立方', '方'].includes(unit))
    return 'm³'
  if (['t', '吨'].includes(unit))
    return '吨'
  if (['kg', '千克', '公斤'].includes(unit))
    return 'kg'
  return normalizeText(value)
}

function materialKey(name: string, spec: string, unit: string): string {
  return [
    identityText(name),
    identityText(spec),
    identityText(normalizeMaterialUnit(unit)),
  ].join('::')
}

function materialLabel(name: string, spec: string, unit: string): string {
  return [name, spec, unit].filter(Boolean).join(' · ')
}

function isValidPrice(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

export function buildMaterialPriceCatalog(
  records: readonly DeliveryPriceRecordInput[],
  suppliers: readonly PricePartyInput[],
  projects: readonly PricePartyInput[],
): MaterialPriceCatalogItem[] {
  const supplierNames = new Map(suppliers.map(supplier => [supplier.id, supplier.name]))
  const projectNames = new Map(projects.map(project => [project.id, project.name]))
  const byMaterial = new Map<string, MaterialPriceCatalogItem>()

  for (const record of records) {
    if (!record.archived || !record.supplierId)
      continue
    const supplierName = supplierNames.get(record.supplierId)
    if (!supplierName)
      continue

    for (const line of record.lines) {
      const name = normalizeText(line.materialName)
      if (!name || NON_MATERIAL_CHARGE.test(name) || !isValidPrice(line.unitPrice))
        continue

      const spec = normalizeMaterialSpec(line.spec)
      const unit = normalizeMaterialUnit(line.unit)
      const key = materialKey(name, spec, unit)
      const officialMatchInput = { name, spec, unit }
      const item = byMaterial.get(key) ?? {
        key,
        officialPriceLookupKey: key,
        category: classifyOfficialMaterialCategory(officialMatchInput),
        officialIdentity: resolveOfficialMaterialIdentity(officialMatchInput),
        name,
        spec,
        unit,
        label: materialLabel(name, spec, unit),
        searchText: identityText(materialLabel(name, spec, unit)),
        facts: [],
      }
      item.facts.push({
        id: `${record.id}:${line.id}`,
        deliveryRecordId: record.id,
        deliveryOrderNo: record.orderNo || record.id,
        date: record.deliveryDate,
        projectId: record.projectId,
        projectName: projectNames.get(record.projectId) ?? '未命名项目',
        supplierId: record.supplierId,
        supplierName,
        price: line.unitPrice,
      })
      byMaterial.set(key, item)
    }
  }

  return [...byMaterial.values()]
    .map(item => ({
      ...item,
      facts: [...item.facts].sort((a, b) =>
        a.date.localeCompare(b.date) || a.deliveryRecordId.localeCompare(b.deliveryRecordId),
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

function latestFact(facts: MaterialPriceFact[]): MaterialPriceFact {
  return [...facts].sort((a, b) =>
    b.date.localeCompare(a.date) || b.deliveryRecordId.localeCompare(a.deliveryRecordId),
  )[0]!
}

function median(values: number[]): number | null {
  if (!values.length)
    return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2)
    return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function analyzeMaterialPrices(
  material: MaterialPriceCatalogItem,
  selectedSupplierIds?: readonly string[],
): MaterialPriceAnalysis {
  const factsBySupplier = new Map<string, MaterialPriceFact[]>()
  for (const fact of material.facts) {
    const facts = factsBySupplier.get(fact.supplierId) ?? []
    facts.push(fact)
    factsBySupplier.set(fact.supplierId, facts)
  }

  const availableSupplierIds = [...factsBySupplier.keys()]
  const requestedSupplierIds = selectedSupplierIds?.filter(id => factsBySupplier.has(id))
  const supplierIds = (requestedSupplierIds?.length ? requestedSupplierIds : availableSupplierIds)
    .slice(0, 4)
  const mode = supplierIds.some((id) => {
    const facts = factsBySupplier.get(id) ?? []
    return new Set(facts.map(fact => fact.date)).size > 1
  })
    ? 'trend'
    : 'comparison'

  const series = supplierIds.map((supplierId) => {
    const points = [...(factsBySupplier.get(supplierId) ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
    return {
      supplierId,
      supplierName: points[0]?.supplierName ?? supplierId,
      points,
    }
  })

  const latest = supplierIds
    .map(id => factsBySupplier.get(id) ?? [])
    .filter(facts => facts.length > 0)
    .map(latestFact)
  const prices = latest.map(fact => fact.price)
  const lowestPrice = prices.length ? Math.min(...prices) : null
  const highestPrice = prices.length ? Math.max(...prices) : null
  const comparisons = latest
    .map(fact => ({
      ...fact,
      isLowest: lowestPrice != null && fact.price === lowestPrice,
    }))
    .sort((a, b) => a.price - b.price || a.supplierName.localeCompare(b.supplierName, 'zh-CN'))

  return {
    mode,
    supplierIds,
    series,
    comparisons,
    lowestPrice,
    medianPrice: median(prices),
    spread: lowestPrice == null || highestPrice == null ? null : highestPrice - lowestPrice,
  }
}

export function buildSupplierContractRows(
  supplierIds: readonly string[],
  contracts: readonly MaterialContractInput[],
  suppliers: readonly PricePartyInput[],
  projects: readonly PricePartyInput[],
): SupplierContractRow[] {
  const eligibleSupplierIds = new Set(supplierIds)
  const supplierNames = new Map(suppliers.map(supplier => [supplier.id, supplier.name]))
  const projectNames = new Map(projects.map(project => [project.id, project.name]))
  const rows = new Map<string, SupplierContractRow>()

  for (const contract of contracts) {
    if (
      contract.kind !== '材采'
      || !contract.supplierId
      || !eligibleSupplierIds.has(contract.supplierId)
    ) {
      continue
    }

    const key = `${contract.supplierId}:${contract.projectId}`
    const row = rows.get(key) ?? {
      key,
      supplierId: contract.supplierId,
      supplierName: supplierNames.get(contract.supplierId) ?? '未命名分供方',
      projectId: contract.projectId,
      projectName: projectNames.get(contract.projectId) ?? '未命名项目',
      contractCount: 0,
      totalAmount: 0,
      contracts: [],
    }
    row.contractCount += 1
    row.totalAmount += Number.isFinite(contract.amount) ? contract.amount : 0
    row.contracts.push({
      id: contract.id,
      name: contract.name,
      no: contract.no,
      amount: contract.amount,
      signDate: contract.signDate,
    })
    rows.set(key, row)
  }

  return [...rows.values()]
    .map(row => ({
      ...row,
      contracts: [...row.contracts].sort((a, b) =>
        b.signDate.localeCompare(a.signDate) || a.name.localeCompare(b.name, 'zh-CN'),
      ),
    }))
    .sort((a, b) =>
      a.supplierName.localeCompare(b.supplierName, 'zh-CN')
      || a.projectName.localeCompare(b.projectName, 'zh-CN'),
    )
}
