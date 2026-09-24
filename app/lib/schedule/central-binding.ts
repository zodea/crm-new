import type { TransactionDb } from '../db/coordinator'
import type { QuantityBoqLine } from '../quantity/central-boq'
import type { ScheduleBindingItem, ScheduleBindingPreview, ScheduleBindingRead, ScheduleBindingRecord, ScheduleBindingResult } from './central-binding-contract'
import type { ScheduleReadContext } from './central-contract'
import { fetchRowById, hiddenCtesFor, logOperation, selectVisibleSql, visibleCond } from '../db/soft-delete'
import { quantityMeasureTotal } from '../quantity/totals'
import { resolveScheduleBuildingReference } from './building-reference'
import { decodeScheduleBindingRead } from './central-binding-decoder'
import { scheduleProblem } from './central-contract'
import { SCHEDULE_CONTRACT_BIND_OPERATOR } from './contract-binding'
import { loadBoqLinesByItem } from './engine'
import { loadScheduleContracts } from './read-model'

interface GroupRow { id: string, name: string, project_id: string, scope_basis: 'contract' | 'provisional' | null, contract_id: string | null, contract_bound_at: string | null }
interface FrozenFloor { id: string, item_id: string, floor_id: string, provisional_qty: number | null, code: string, name: string, snapshot_json: string | null, legacy_missing: number | null }
interface QuantityFact { id: string, value: number | null }
interface FrozenItem { id: string, code: string, name: string, unit: string, facts: Map<string, QuantityFact>, floorPlanIds: Set<string>, reasons: Set<string> }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function nullableQuantity(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}
function quantity(facts: readonly QuantityFact[], unit: string) {
  const known = facts.filter((row): row is QuantityFact & { value: number } => row.value !== null)
  return quantityMeasureTotal(known.length ? known.reduce((sum, row) => sum + row.value, 0) : null, facts.length, facts.length - known.length, unit)
}
function validFrozenSnapshot(snapshot: unknown): snapshot is { unit: string, sources: { unitId: string, templateItemId: string, quantity: number | null, unit: string }[] } {
  if (!record(snapshot) || typeof snapshot.unit !== 'string' || !Array.isArray(snapshot.sources) || !snapshot.sources.length
    || !snapshot.sources.every(source => record(source) && typeof source.unitId === 'string' && source.unitId && typeof source.templateItemId === 'string' && source.templateItemId && source.unit === snapshot.unit && nullableQuantity(source.quantity))) {
    return false
  }
  const facts = snapshot.sources.map(source => ({ id: JSON.stringify([source.unitId, source.templateItemId]), value: source.quantity as number | null }))
  if (new Set(facts.map(row => row.id)).size !== facts.length)
    return false
  const expected = quantity(facts, snapshot.unit)
  return Object.entries(expected).every(([key, value]) => typeof value === 'number' && typeof snapshot[key] === 'number'
    ? Math.abs(value - snapshot[key]) <= 1e-8
    : snapshot[key] === value)
}

async function frozenItems(db: TransactionDb, groupId: string): Promise<FrozenItem[]> {
  const floors = await db.select<FrozenFloor>(`${hiddenCtesFor('schedule_task_floor_plans')}
    SELECT plan.id, plan.item_id, plan.floor_id, plan.provisional_qty, item.code, item.name, evidence.snapshot_json, evidence.legacy_missing
    FROM schedule_task_floor_plans plan JOIN schedule_tasks task ON task.id = plan.task_id
      JOIN items item ON item.id = plan.item_id
      LEFT JOIN schedule_floor_quantity_snapshots evidence ON evidence.id = plan.id
    WHERE ${visibleCond('schedule_task_floor_plans', 'plan')} AND task.group_id = ? AND plan.source_basis = 'provisional'
    ORDER BY plan.id`, [groupId])
  const groups = new Map<string, FrozenItem>()
  function item(row: Pick<FrozenFloor, 'item_id' | 'code' | 'name'>, unit: string) {
    const key = JSON.stringify([row.item_id, unit])
    if (!groups.has(key))
      groups.set(key, { id: row.item_id, code: row.code, name: row.name, unit, facts: new Map(), floorPlanIds: new Set(), reasons: new Set() })
    return groups.get(key)!
  }
  for (const row of floors) {
    let snapshot: unknown = null
    try {
      snapshot = row.snapshot_json ? JSON.parse(row.snapshot_json) : null
    }
    catch { /* 旧缺损证据保留为不可确定，不能回填当前模板。 */ }
    if (row.legacy_missing || !validFrozenSnapshot(snapshot)) {
      const target = item(row, '')
      target.floorPlanIds.add(row.id)
      target.facts.set(`legacy:${row.floor_id}:${row.item_id}`, { id: row.id, value: null })
      target.reasons.add(`旧楼层未保存完整单位和逐户暂估依据${row.provisional_qty === null ? '' : `（原记录数值 ${row.provisional_qty}）`}`)
      continue
    }
    for (const value of snapshot.sources) {
      const source = value
      const target = item(row, source.unit.trim())
      target.floorPlanIds.add(row.id)
      // 同一户/模板行可能被多个阶段工序引用，只作为一份冻结工程量；矛盾快照保持未知。
      const key = JSON.stringify([source.unitId, source.templateItemId])
      const existing = target.facts.get(key)
      if (existing && existing.value !== source.quantity) {
        existing.value = null
        target.reasons.add('同一来源在多个工序中的冻结数值不一致')
      }
      else if (!existing) {
        target.facts.set(key, { id: key, value: source.quantity })
      }
    }
  }
  const mapped = await db.select<{ item_id: string, code: string, name: string }>(`${hiddenCtesFor('task_item_map')}
    SELECT DISTINCT map.item_id, item.code, item.name FROM task_item_map map
      JOIN schedule_tasks task ON task.id = map.task_id JOIN items item ON item.id = map.item_id
    WHERE ${visibleCond('task_item_map', 'map')} AND task.group_id = ?`, [groupId])
  for (const row of mapped) {
    if (![...groups.values()].some(value => value.id === row.item_id)) {
      const target = item(row, '')
      target.facts.set(`missing:${row.item_id}`, { id: row.item_id, value: null })
      target.reasons.add('该分项没有可核验的冻结楼层暂估资料')
    }
  }
  return [...groups.values()]
}

async function preview(db: TransactionDb, group: GroupRow, contractId: string, boq: readonly QuantityBoqLine[]): Promise<ScheduleBindingPreview> {
  const [contract] = await db.select<{ id: string, no: string, name: string }>(selectVisibleSql('contracts', 'AND id = ? AND project_id = ? AND kind = \'施工\''), [contractId, group.project_id])
  if (!contract)
    throw scheduleProblem('relationship-mismatch', '施工合同不存在、已隐藏或不属于当前项目')
  const buildings = await db.select<{ id: string, code: string, name: string }>(selectVisibleSql('buildings', 'AND project_id = ? ORDER BY sort_order, code, id'), [group.project_id])
  const relations = await db.select<{ building_id: string }>(selectVisibleSql('schedule_group_buildings', 'AND group_id = ? ORDER BY sort_order, id'), [group.id])
  const ids = new Set(relations.map(row => row.building_id))
  const lines = boq.filter(row => row.contractId === contractId).map(row => ({ ...row, resolvedBuilding: resolveScheduleBuildingReference(buildings, row.building) }))
  const coverage = buildings.map((row) => {
    const count = lines.filter(line => line.resolvedBuilding?.id === row.id).length
    return { id: row.id, code: row.code, name: row.name, contractLineCount: count, covered: count > 0 }
  })
  const selected = coverage.filter(row => ids.has(row.id))
  const extra = coverage.filter(row => !ids.has(row.id) && row.covered)
  const frozen = await frozenItems(db, group.id)
  const currentItems = await db.select<{ id: string, code: string, name: string }>(selectVisibleSql('items', 'AND project_id = ?'), [group.project_id])
  const mappings = await loadBoqLinesByItem(db, group.project_id, contractId, [...new Set([...frozen.map(row => row.id), ...currentItems.map(row => row.id)])])
  const scopeLines = lines.filter(row => row.resolvedBuilding && ids.has(row.resolvedBuilding.id))
  for (const current of currentItems) {
    if (frozen.some(row => row.id === current.id))
      continue
    const mappedIds = new Set((mappings.get(current.id) ?? []).map(row => row.id))
    for (const unit of new Set(scopeLines.filter(row => mappedIds.has(row.id)).map(row => row.unit.trim()))) {
      frozen.push({ ...current, unit, facts: new Map([['missing', { id: 'missing', value: null }]]), floorPlanIds: new Set(), reasons: new Set(['当前合同分项没有对应冻结暂估来源']) })
    }
  }
  const items: ScheduleBindingItem[] = []
  for (const frozenItem of frozen) {
    const mappedIds = new Set((mappings.get(frozenItem.id) ?? []).map(row => row.id))
    const matching = scopeLines.filter(row => mappedIds.has(row.id))
    const sameUnit = matching.filter(row => row.unit.trim() === frozenItem.unit)
    const contractFacts = sameUnit.flatMap(row => [
      { id: row.id, value: row.qty },
      ...(row.approvedDeltaQty ? [{ id: `${row.id}:approved-change`, value: row.approvedDeltaQty }] : []),
    ])
    const provisional = quantity([...frozenItem.facts.values()], frozenItem.unit)
    const contractQuantity = quantity(contractFacts.length ? contractFacts : [{ id: 'missing', value: null }], frozenItem.unit)
    const reasons = [...frozenItem.reasons]
    if (!matching.length)
      reasons.push('当前合同清单未关联此稳定分项')
    if (!frozenItem.unit)
      reasons.push('冻结单位未提供')
    if (matching.some(row => row.unit.trim() !== frozenItem.unit))
      reasons.push('合同与冻结暂估包含不同计量单位，分别比较')
    if (provisional.completeness !== 'complete' || contractQuantity.completeness !== 'complete')
      reasons.push('来源数量不完整，差值不可确定')
    const complete = provisional.value !== null && contractQuantity.value !== null
    items.push({ id: frozenItem.id, code: frozenItem.code, name: frozenItem.name, unit: frozenItem.unit, mapped: matching.length > 0, provisional, contract: contractQuantity, differenceQty: complete ? contractQuantity.value! - provisional.value! : null, reasons, floorPlanIds: [...frozenItem.floorPlanIds], contractLineIds: sameUnit.map(row => row.id) })
    // 合同独有单位也显示原值，不能藏掉异单位来源或填一份暂估零。
    for (const unit of new Set(matching.map(row => row.unit.trim()).filter(unit => unit !== frozenItem.unit))) {
      if (frozen.some(row => row.id === frozenItem.id && row.unit === unit) || items.some(row => row.id === frozenItem.id && row.unit === unit))
        continue
      const values = matching.filter(row => row.unit.trim() === unit).flatMap(row => [{ id: row.id, value: row.qty }, ...(row.approvedDeltaQty ? [{ id: `${row.id}:approved-change`, value: row.approvedDeltaQty }] : [])])
      items.push({ id: frozenItem.id, code: frozenItem.code, name: frozenItem.name, unit, mapped: true, provisional: quantity([{ id: 'missing', value: null }], unit), contract: quantity(values, unit), differenceQty: null, reasons: ['该合同单位没有对应完整冻结暂估来源'], floorPlanIds: [], contractLineIds: matching.filter(row => row.unit.trim() === unit).map(row => row.id) })
    }
  }
  const blockers: string[] = []
  if (!selected.length)
    blockers.push('分组没有当前有效楼栋范围')
  const uncovered = selected.filter(row => !row.covered)
  if (uncovered.length)
    blockers.push(`合同清单未明确覆盖楼栋：${uncovered.map(row => row.name).join('、')}`)
  const unmapped = [...new Set(items.filter(row => !row.mapped).map(row => row.name))]
  if (unmapped.length)
    blockers.push(`排程分项尚未关联当前合同清单：${unmapped.join('、')}`)
  const warnings = extra.length ? [`合同还包含分组外楼栋：${extra.map(row => row.name).join('、')}`] : []
  if (lines.some(row => !row.resolvedBuilding))
    warnings.push('部分清单楼栋为空、失效或存在歧义，未作为覆盖依据')
  return { groupId: group.id, groupName: group.name, projectId: group.project_id, contractId, contractNo: contract.no, contractName: contract.name, buildings: selected, extraContractBuildings: extra, items, blockers, warnings, canBind: !blockers.length }
}

export async function readScheduleBinding(db: TransactionDb, context: ScheduleReadContext, projectId: string, groupId: string, contractId: string, boq: readonly QuantityBoqLine[]): Promise<ScheduleBindingRead> {
  const [group] = await db.select<GroupRow>(selectVisibleSql('schedule_groups', 'AND id = ? AND project_id = ?'), [groupId, projectId])
  if (!group)
    throw scheduleProblem('not-found', '楼栋分组不存在、已隐藏或不属于当前项目')
  const scopeBasis = group.scope_basis ?? (group.contract_id ? 'contract' : 'provisional')
  const contracts = await loadScheduleContracts(db, projectId)
  const result = { ...context, group: { id: group.id, name: group.name, projectId, scopeBasis, contractId: group.contract_id }, contracts }
  if (group.contract_id) {
    if (contractId && contractId !== group.contract_id)
      throw scheduleProblem('conflict', '该分组已经绑定其他施工合同，不支持换绑')
    const logs = await db.select<{ after_data: string | null }>('SELECT after_data FROM operation_logs WHERE table_name = ? AND record_id = ? AND operator = ? ORDER BY created_at DESC, id DESC', ['schedule_groups', groupId, SCHEDULE_CONTRACT_BIND_OPERATOR])
    const contract = contracts.find(row => row.id === group.contract_id)
    let evidence: ScheduleBindingRecord | null = null
    for (const log of logs) {
      let after: unknown = null
      try {
        after = log.after_data ? JSON.parse(log.after_data) : null
      }
      catch { continue }
      if (record(after) && record(after.bindingEvidence) && after.bindingEvidence.contractId === group.contract_id) {
        try {
          evidence = decodeScheduleBindingRead({ ...result, state: 'bound', preview: null, binding: after.bindingEvidence }, projectId, groupId, group.contract_id).binding
          break
        }
        catch { /* 比较证据缺损仍保留当前绑定关系，按明确历史缺口读取。 */ }
      }
    }
    return { ...result, state: 'bound', preview: null, binding: evidence ?? { contractId: group.contract_id, contractNo: contract?.no ?? '', contractName: contract?.name ?? '', boundAt: group.contract_bound_at, actorId: null, sourceVersion: null, preview: null, legacyDetailMissing: true } }
  }
  if (scopeBasis !== 'provisional')
    throw scheduleProblem('relationship-mismatch', '分组绑定依据不完整，请先核对迁入历史')
  return { ...result, state: 'unbound', binding: null, preview: contractId ? await preview(db, group, contractId, boq) : null }
}

export async function bindCentralScheduleContract(db: TransactionDb, context: ScheduleReadContext, projectId: string, groupId: string, contractId: string, boq: readonly QuantityBoqLine[]): Promise<ScheduleBindingResult> {
  const read = await readScheduleBinding(db, context, projectId, groupId, contractId, boq)
  if (read.state === 'bound')
    throw scheduleProblem('conflict', '该分组已经绑定施工合同，请重新读取既有结果')
  if (!read.preview?.canBind)
    throw scheduleProblem('validation-failed', read.preview?.blockers.join('；') || '请先选择同项目施工合同')
  const before = await fetchRowById(db, 'schedule_groups', groupId)
  const binding: ScheduleBindingRecord = { contractId, contractNo: read.preview.contractNo, contractName: read.preview.contractName, boundAt: new Date().toISOString(), actorId: context.actorId, sourceVersion: context.sourceVersion, preview: read.preview, legacyDetailMissing: false }
  await db.execute('UPDATE schedule_groups SET contract_id = ?, scope_basis = \'contract\', contract_bound_at = ?, updated_at = ? WHERE id = ? AND contract_id IS NULL', [contractId, binding.boundAt, binding.boundAt, groupId])
  const after = await fetchRowById(db, 'schedule_groups', groupId)
  const logId = await logOperation(db, { table: 'schedule_groups', recordId: groupId, action: 'update', before, after: { ...after, bindingEvidence: binding }, operator: SCHEDULE_CONTRACT_BIND_OPERATOR })
  return { groupId, contractId, logId, binding }
}
