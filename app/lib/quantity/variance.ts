import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export type QuantityVarianceBasis = 'contract' | 'provisional' | 'field'
export type QuantityVarianceCompleteness = 'complete' | 'missing'
export type QuantityVariancePriceStatus = 'single' | 'mixed' | 'missing'

export interface QuantityVarianceFact {
  id: string
  buildingId: string
  buildingName: string
  buildingSortOrder: number
  itemId: string
  itemName: string
  itemSortOrder: number
  section: string
  trade: string
  unit: string
  contractQty: number | null
  provisionalQty: number | null
  fieldQty: number | null
  effectiveUnitPrice: number | null
  updatedAt: string
}

export interface QuantityVarianceRow {
  id: string
  buildingId: string
  buildingName: string
  itemId: string
  itemName: string
  section: string
  trade: string
  unit: string
  sourceLineCount: number
  contractQty: number | null
  basisQty: number | null
  differenceQty: number | null
  contractUnitPrice: number | null
  priceStatus: QuantityVariancePriceStatus
  differenceAmount: number | null
  contractStatus: QuantityVarianceCompleteness
  basisStatus: QuantityVarianceCompleteness
  missingContractCount: number
  missingBasisCount: number
  missingPriceCount: number
  sourceUpdatedAt: string
  buildingSortOrder: number
  itemSortOrder: number
}

export interface QuantityVarianceFilter {
  buildingId?: string
  section?: string
  trade?: string
  itemKeyword?: string
}

interface QuantityVarianceFactRow {
  unit_id: string
  template_item_id: string
  building_id: string
  building_code: string
  building_name: string
  building_sort_order: number
  item_id: string
  item_name: string
  item_sort_order: number
  section: string | null
  trade: string
  unit: string | null
  contract_qty: number | null
  provisional_qty: number | null
  field_qty: number | null
  boq_line_id: string | null
  boq_building: string | null
  base_unit_price: number | null
  template_item_updated_at: string
  boq_line_updated_at: string | null
}

interface ApprovedChangeRow {
  id: string
  boq_line_id: string
  operation: 'qty' | 'price'
  delta_qty: number | null
  new_unit_price: number | null
  approved_at: string
  order_created_at: string
  sort_order: number
  updated_at: string
}

interface EffectiveBoqAdjustment {
  approvedDeltaQty: number
  effectiveUnitPrice: number | null
  updatedAt: string
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function roundAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function laterTimestamp(left: string, right: string | null | undefined): string {
  return right && right > left ? right : left
}

function buildEffectiveBoqAdjustments(
  facts: readonly QuantityVarianceFactRow[],
  changes: readonly ApprovedChangeRow[],
): Map<string, EffectiveBoqAdjustment> {
  const adjustments = new Map<string, EffectiveBoqAdjustment>()
  for (const fact of facts) {
    if (!fact.boq_line_id || adjustments.has(fact.boq_line_id))
      continue
    adjustments.set(fact.boq_line_id, {
      approvedDeltaQty: 0,
      effectiveUnitPrice: nullableNumber(fact.base_unit_price),
      updatedAt: fact.boq_line_updated_at ?? fact.template_item_updated_at,
    })
  }
  for (const change of changes) {
    const adjustment = adjustments.get(change.boq_line_id)
    if (!adjustment)
      continue
    if (change.operation === 'qty')
      adjustment.approvedDeltaQty = roundQuantity(adjustment.approvedDeltaQty + numberValue(change.delta_qty))
    else
      adjustment.effectiveUnitPrice = nullableNumber(change.new_unit_price)
    adjustment.updatedAt = laterTimestamp(adjustment.updatedAt, change.updated_at)
  }
  return adjustments
}

/**
 * 量差总表的最细事实是「实际户 × 户型模板分项」。
 * 合同量、临时量、现场量均直接读取模板行；合同调量与调价只消费已审批 BOQ 变更，
 * 不写入汇总表，因此不会产生第二事实源。
 */
export async function loadQuantityVarianceFacts(
  db: SoftDb,
  projectId: string,
): Promise<QuantityVarianceFact[]> {
  const facts = await db.select<QuantityVarianceFactRow>(
    `${hiddenCtesFor(
      'units',
      'house_type_template_items',
      'boq_lines',
      'boq_change_lines',
    )}
     SELECT u.id AS unit_id,
            hti.id AS template_item_id,
            b.id AS building_id,
            b.code AS building_code,
            b.name AS building_name,
            b.sort_order AS building_sort_order,
            i.id AS item_id,
            i.name AS item_name,
            i.sort_order AS item_sort_order,
            i.section,
            i.trade,
            i.unit,
            hti.contract_qty,
            hti.provisional_qty,
            hti.field_qty,
            boq.id AS boq_line_id,
            boq.building AS boq_building,
            boq.unit_price AS base_unit_price,
            hti.updated_at AS template_item_updated_at,
            boq.updated_at AS boq_line_updated_at
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     JOIN rooms r ON r.template_id = u.house_type_template_id
     JOIN house_type_template_items hti ON hti.room_id = r.id
     JOIN items i ON i.id = hti.item_id
     LEFT JOIN boq_lines boq
       ON boq.id = hti.boq_line_id
      AND boq.project_id = ?
      AND ${visibleCond('boq_lines', 'boq')}
     WHERE ${visibleCond('units', 'u')}
       AND ${visibleCond('house_type_template_items', 'hti')}
       AND b.project_id = ?
       AND ht.project_id = ?
       AND i.project_id = ?
     ORDER BY b.sort_order, b.code, b.id, i.sort_order, i.code, i.id, u.sort_order, u.id, hti.sort_order, hti.id`,
    [projectId, projectId, projectId, projectId],
  )

  const linkedBoqLineIds = [...new Set(
    facts.map(row => row.boq_line_id).filter((id): id is string => Boolean(id)),
  )]
  let changes: ApprovedChangeRow[] = []
  if (linkedBoqLineIds.length) {
    const placeholders = linkedBoqLineIds.map(() => '?').join(', ')
    changes = await db.select<ApprovedChangeRow>(
      `${hiddenCtesFor('boq_change_lines')}
       SELECT line.id,
              line.boq_line_id,
              line.operation,
              line.delta_qty,
              line.new_unit_price,
              order_row.approved_at,
              order_row.created_at AS order_created_at,
              line.sort_order,
              line.updated_at
       FROM boq_change_lines line
       JOIN boq_change_orders order_row ON order_row.id = line.change_order_id
       WHERE ${visibleCond('boq_change_lines', 'line')}
         AND ${visibleCond('boq_change_orders', 'order_row')}
         AND order_row.status = 'approved'
         AND order_row.project_id = ?
         AND line.operation IN ('qty', 'price')
         AND line.boq_line_id IN (${placeholders})
       ORDER BY order_row.approved_at, order_row.created_at, line.sort_order, line.id`,
      [projectId, ...linkedBoqLineIds],
    )
  }
  const adjustments = buildEffectiveBoqAdjustments(facts, changes)

  const quantityFacts = facts.map<QuantityVarianceFact>((row) => {
    const adjustment = row.boq_line_id ? adjustments.get(row.boq_line_id) : undefined
    const contractQty = nullableNumber(row.contract_qty)
    return {
      id: `${row.unit_id}:${row.template_item_id}`,
      buildingId: row.building_id,
      buildingName: row.building_name,
      buildingSortOrder: numberValue(row.building_sort_order),
      itemId: row.item_id,
      itemName: row.item_name,
      itemSortOrder: numberValue(row.item_sort_order),
      section: row.section ?? '',
      trade: row.trade,
      unit: row.unit ?? '',
      contractQty,
      provisionalQty: nullableNumber(row.provisional_qty),
      fieldQty: nullableNumber(row.field_qty),
      effectiveUnitPrice: adjustment?.effectiveUnitPrice ?? null,
      updatedAt: laterTimestamp(
        row.template_item_updated_at,
        adjustment?.updatedAt ?? row.boq_line_updated_at,
      ),
    }
  })

  // 调量签证属于 BOQ 行级事实，不能随「实际户 × 模板行」展开，否则会按户重复累计。
  // 有唯一楼栋证据时落入该楼栋；同一 BOQ 行跨多个楼栋且缺少分摊关系时，单列为
  // “待分摊签证”项目级行，让项目合计仍只计一次，同时显式暴露楼栋归属缺口。
  const changeFacts: QuantityVarianceFact[] = []
  for (const [boqLineId, adjustment] of adjustments) {
    if (!adjustment.approvedDeltaQty)
      continue
    const linkedRows = facts.filter(row => row.boq_line_id === boqLineId)
    const first = linkedRows[0]
    if (!first)
      continue
    const buildings = [...new Map(linkedRows.map(row => [row.building_id, row])).values()]
    const declaredBuilding = first.boq_building?.trim() ?? ''
    const declaredMatches = declaredBuilding
      ? buildings.filter(row =>
          row.building_id === declaredBuilding
          || row.building_code === declaredBuilding
          || row.building_name === declaredBuilding,
        )
      : []
    const targetBuilding = declaredMatches.length === 1
      ? declaredMatches[0]
      : buildings.length === 1
        ? buildings[0]
        : null
    changeFacts.push({
      id: `approved-change:${boqLineId}`,
      buildingId: targetBuilding?.building_id ?? '__unallocated_approved_change__',
      buildingName: targetBuilding?.building_name ?? '待分摊签证',
      buildingSortOrder: targetBuilding
        ? numberValue(targetBuilding.building_sort_order)
        : Number.MAX_SAFE_INTEGER,
      itemId: first.item_id,
      itemName: first.item_name,
      itemSortOrder: numberValue(first.item_sort_order),
      section: first.section ?? '',
      trade: first.trade,
      unit: first.unit ?? '',
      contractQty: adjustment.approvedDeltaQty,
      provisionalQty: 0,
      fieldQty: 0,
      effectiveUnitPrice: adjustment.effectiveUnitPrice,
      updatedAt: adjustment.updatedAt,
    })
  }
  return [...quantityFacts, ...changeFacts]
}

function basisValue(fact: QuantityVarianceFact, basis: QuantityVarianceBasis): number | null {
  if (basis === 'contract')
    return fact.contractQty
  if (basis === 'provisional')
    return fact.provisionalQty
  return fact.fieldQty
}

function completeSum(values: readonly (number | null)[]): number | null {
  if (values.some(value => value == null))
    return null
  return roundQuantity(values.reduce<number>((sum, value) => sum + (value ?? 0), 0))
}

export function buildQuantityVarianceRows(
  facts: readonly QuantityVarianceFact[],
  basis: QuantityVarianceBasis,
): QuantityVarianceRow[] {
  const groups = new Map<string, QuantityVarianceFact[]>()
  for (const fact of facts) {
    const key = `${fact.buildingId}:${fact.itemId}`
    const bucket = groups.get(key) ?? []
    bucket.push(fact)
    groups.set(key, bucket)
  }

  return [...groups.entries()]
    .map<QuantityVarianceRow>(([id, group]) => {
      const first = group[0]!
      const contractValues = group.map(fact => fact.contractQty)
      const basisValues = group.map(fact => basisValue(fact, basis))
      const contractQty = completeSum(contractValues)
      const basisQty = completeSum(basisValues)
      const missingContractCount = contractValues.filter(value => value == null).length
      const missingBasisCount = basisValues.filter(value => value == null).length
      const missingPriceCount = group.filter(fact => fact.effectiveUnitPrice == null).length
      const complete = !missingContractCount && !missingBasisCount
      const differenceQty = complete
        ? roundQuantity((basisQty ?? 0) - (contractQty ?? 0))
        : null
      const prices = [...new Set(
        group
          .map(fact => fact.effectiveUnitPrice)
          .filter((value): value is number => value != null),
      )]
      const priceStatus: QuantityVariancePriceStatus = missingPriceCount
        ? 'missing'
        : prices.length === 1
          ? 'single'
          : 'mixed'
      const differenceAmount = complete && !missingPriceCount
        ? roundAmount(group.reduce((sum, fact) => (
            sum
            + ((basisValue(fact, basis) ?? 0) - (fact.contractQty ?? 0))
            * (fact.effectiveUnitPrice ?? 0)
          ), 0))
        : null
      return {
        id,
        buildingId: first.buildingId,
        buildingName: first.buildingName,
        itemId: first.itemId,
        itemName: first.itemName,
        section: first.section,
        trade: first.trade,
        unit: first.unit,
        sourceLineCount: group.length,
        contractQty,
        basisQty,
        differenceQty,
        contractUnitPrice: priceStatus === 'single' ? prices[0]! : null,
        priceStatus,
        differenceAmount,
        contractStatus: missingContractCount ? 'missing' : 'complete',
        basisStatus: missingBasisCount ? 'missing' : 'complete',
        missingContractCount,
        missingBasisCount,
        missingPriceCount,
        sourceUpdatedAt: group.reduce(
          (latest, fact) => laterTimestamp(latest, fact.updatedAt),
          first.updatedAt,
        ),
        buildingSortOrder: first.buildingSortOrder,
        itemSortOrder: first.itemSortOrder,
      }
    })
    .sort((left, right) => (
      left.buildingSortOrder - right.buildingSortOrder
      || left.buildingName.localeCompare(right.buildingName, 'zh-CN')
      || left.itemSortOrder - right.itemSortOrder
      || left.itemName.localeCompare(right.itemName, 'zh-CN')
      || left.id.localeCompare(right.id)
    ))
}

export function filterQuantityVarianceRows(
  rows: readonly QuantityVarianceRow[],
  filter: QuantityVarianceFilter,
): QuantityVarianceRow[] {
  const keyword = filter.itemKeyword?.trim().toLocaleLowerCase('zh-CN') ?? ''
  return rows.filter(row => (
    (!filter.buildingId || row.buildingId === filter.buildingId)
    && (!filter.section || row.section === filter.section)
    && (!filter.trade || row.trade === filter.trade)
    && (!keyword || `${row.itemName} ${row.itemId}`.toLocaleLowerCase('zh-CN').includes(keyword))
  ))
}
