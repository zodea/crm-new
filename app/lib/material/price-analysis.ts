import type {
  OfficialMaterialCategory,
  OfficialMaterialIdentity,
} from './official-price-source'
import {
  classifyOfficialMaterialCategory,
  resolveOfficialMaterialIdentity,
} from './official-price-source'
import { parseWireMaterialIdentity } from './wire-identity'

export interface DeliveryPriceLineInput {
  id: string
  materialName: string
  spec: string
  unit: string
  unitPrice: number | null
  amount: number | null
  qty?: number | null
  /** 识别/导入后的当前单价是否已由人工确认。 */
  currentValueConfirmed: boolean
  originalOcrUnitPrice?: number | null
  revisionReason?: string
}

export interface DeliveryPriceRecordInput {
  dataOrigin?: 'real' | 'demo'
  id: string
  version?: string
  assetId?: string | null
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  archived: boolean
  lines: readonly DeliveryPriceLineInput[]
  reviewStatus: 'reviewed' | 'unreviewed'
  ocrStatus: string
  naturalKeyDuplicate: boolean
  currentValuesConfirmed: boolean
  hasSourceFile: boolean
}

export interface PricePartyInput {
  id: string
  name: string
}

export interface MaterialPriceFact {
  dataOrigin?: 'real' | 'demo'
  id: string
  deliveryRecordId: string
  deliveryOrderNo: string
  date: string
  projectId: string
  projectName: string
  supplierId: string
  supplierName: string
  price: number
  /** 当前价格事实的来源留痕；分析只读取 price，不回写原始 OCR 或修订值。 */
  provenance: {
    sourceKind: 'delivery'
    sourceRecordId: string
    sourceLineId: string
    originalOcrUnitPrice: number | null
    revisionReason: string
  }
}

export interface MaterialPriceCatalogItem {
  key: string
  /** 稳定材料身份键；电线使用“型号+芯数+截面+单位”，其他材料使用“名称+规格+单位”。 */
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
  dataOrigin?: 'real' | 'demo'
  id: string
  kind: string
  supplierId: string | null
  projectId: string
  name: string
  no: string
  amount: number | null
  signDate: string
}

export interface SupplierContractDetail {
  dataOrigin?: 'real' | 'demo'
  id: string
  name: string
  no: string
  amount: number | null
  signDate: string
}

export interface SupplierContractRow {
  key: string
  supplierId: string
  supplierName: string
  projectId: string
  projectName: string
  contractCount: number
  totalAmount: number | null
  contracts: SupplierContractDetail[]
}

const NON_MATERIAL_CHARGE = /运费|运输费|搬运费|上楼费|装卸费|吊装费/

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeMaterialIdentityText(value: string): string {
  return normalizeText(value)
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, '')
    .replace(/[×✕*]/g, 'x')
    .replace(/m2/g, 'm²')
    .replace(/m3/g, 'm³')
}

function normalizeMaterialSpec(value: string): string {
  return normalizeText(value)
    .replace(/m2\b/gi, 'm²')
    .replace(/m3\b/gi, 'm³')
}

export function normalizeMaterialUnit(value: string): string {
  const unit = normalizeMaterialIdentityText(value)
  if (['m', '米'].includes(unit))
    return 'm'
  if (['km', '千米', '公里'].includes(unit))
    return 'km'
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
    normalizeMaterialIdentityText(name),
    normalizeMaterialIdentityText(spec),
    normalizeMaterialIdentityText(normalizeMaterialUnit(unit)),
  ].join('::')
}

function materialLabel(name: string, spec: string, unit: string): string {
  return [name, spec, unit].filter(Boolean).join(' · ')
}

function isValidPrice(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

export function hasConfirmedDeliveryPriceSource(record: DeliveryPriceRecordInput): boolean {
  return record.archived && Boolean(record.supplierId) && Boolean(record.projectId)
    && Boolean(record.deliveryDate.trim()) && record.reviewStatus === 'reviewed'
    && (record.ocrStatus === 'done' || record.ocrStatus === 'reviewed')
    && !record.naturalKeyDuplicate && record.currentValuesConfirmed && record.hasSourceFile
}

/** Zero is visible in an original-price projection; the established trend still requires positive samples. */
export function hasConfirmedMaterialPriceLine(line: DeliveryPriceLineInput, includeZero = false): boolean {
  const validPrice = isValidPrice(line.unitPrice) || (includeZero && line.unitPrice === 0)
  return Boolean(line.id.trim()) && Boolean(normalizeText(line.materialName))
    && Boolean(normalizeText(line.unit)) && !NON_MATERIAL_CHARGE.test(normalizeText(line.materialName))
    && validPrice && line.amount != null && line.currentValueConfirmed
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
    if (!hasConfirmedDeliveryPriceSource(record) || !record.supplierId) {
      continue
    }
    const supplierName = supplierNames.get(record.supplierId)
    if (!supplierName)
      continue

    for (const line of record.lines) {
      const name = normalizeText(line.materialName)
      if (!hasConfirmedMaterialPriceLine(line) || !isValidPrice(line.unitPrice)) {
        continue
      }

      const spec = normalizeMaterialSpec(line.spec)
      const unit = normalizeMaterialUnit(line.unit)
      const wireIdentity = parseWireMaterialIdentity({ name, spec })
      const normalizedName = wireIdentity?.displayName ?? name
      const normalizedSpec = wireIdentity?.displaySpec ?? spec
      const key = wireIdentity
        ? `${wireIdentity.key}::${normalizeMaterialIdentityText(unit)}`
        : materialKey(normalizedName, normalizedSpec, unit)
      const officialMatchInput = {
        name: normalizedName,
        spec: normalizedSpec,
        unit,
      }
      const aliasSearchText = normalizeMaterialIdentityText(materialLabel(name, spec, unit))
      const item = byMaterial.get(key) ?? {
        key,
        officialPriceLookupKey: key,
        category: classifyOfficialMaterialCategory(officialMatchInput),
        officialIdentity: resolveOfficialMaterialIdentity(officialMatchInput),
        name: normalizedName,
        spec: normalizedSpec,
        unit,
        label: materialLabel(normalizedName, normalizedSpec, unit),
        searchText: normalizeMaterialIdentityText(materialLabel(normalizedName, normalizedSpec, unit)),
        facts: [],
      }
      if (!item.searchText.includes(aliasSearchText))
        item.searchText = `${item.searchText} ${aliasSearchText}`
      item.facts.push({
        id: `${record.id}:${line.id}`,
        deliveryRecordId: record.id,
        dataOrigin: record.dataOrigin,
        deliveryOrderNo: record.orderNo || record.id,
        date: record.deliveryDate,
        projectId: record.projectId,
        projectName: projectNames.get(record.projectId) ?? '未命名项目',
        supplierId: record.supplierId,
        supplierName,
        price: line.unitPrice,
        provenance: {
          sourceKind: 'delivery',
          sourceRecordId: record.id,
          sourceLineId: line.id,
          originalOcrUnitPrice: line.originalOcrUnitPrice ?? null,
          revisionReason: line.revisionReason ?? '',
        },
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

    const key = JSON.stringify([contract.dataOrigin ?? 'native', contract.supplierId, contract.projectId])
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
    row.totalAmount = row.totalAmount === null || contract.amount === null || !Number.isFinite(contract.amount)
      ? null
      : row.totalAmount + contract.amount
    row.contracts.push({
      id: contract.id,
      dataOrigin: contract.dataOrigin,
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
