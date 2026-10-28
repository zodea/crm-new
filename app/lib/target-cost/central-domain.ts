import type { TransactionDb } from '../db/coordinator'
import type { MasterDataSaveAction, TargetCostFormDraft } from '../master-data/forms'
import { logCreate, selectVisibleSql, withUpdateLog } from '../db/soft-delete'
import { round2 } from '../util/number'
import { TARGET_COST_DRAFT_KEYS, TARGET_COST_MONEY_FIELDS, targetCostProblem } from './central-contract'

/** Read metadata belongs to the read model, never to the editable command draft. */
export function targetCostEditableDraft(header: TargetCostFormDraft): TargetCostFormDraft {
  return Object.fromEntries(TARGET_COST_DRAFT_KEYS.filter(key => Object.hasOwn(header, key)).map(key => [key, header[key]]))
}

export function normalizeTargetCostHeader(draft: TargetCostFormDraft, action: MasterDataSaveAction, existingStatus = 'draft') {
  const status = action === 'submit' ? 'submitted' : action === 'draft' ? 'draft' : existingStatus
  const projectId = typeof draft.projectId === 'string' && draft.projectId.trim() ? draft.projectId.trim() : null
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  const errors: Record<string, string[]> = {}
  if (action !== 'draft') {
    if (!projectId)
      errors.projectId = ['请选择项目']
    if (!name)
      errors.name = ['请填写版本名称']
  }
  const values: Record<string, unknown> = {
    project_id: projectId,
    name,
    is_baseline: draft.isBaseline ? 1 : 0,
    note: typeof draft.note === 'string' ? draft.note : '',
    status,
  }
  const columns = ['contract_revenue', 'planned_profit', 'signed_contract_sum', 'tax_inclusive_total', 'tax_exclusive_total', 'tax_amount']
  TARGET_COST_MONEY_FIELDS.forEach((field, index) => {
    const value = draft[field]
    if (value == null) {
      values[columns[index]!] = null
      if (status === 'submitted')
        errors[field] = ['提交的金额必须填写，可填写 0']
    }
    else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      errors[field] = ['金额必须是非负数']
    }
    else {
      values[columns[index]!] = round2(value)
    }
  })
  if (Object.keys(errors).length)
    throw targetCostProblem('validation-failed', '请检查预算版本字段', errors)
  return values
}

export async function persistTargetCostHeader(tx: TransactionDb, id: string, draft: TargetCostFormDraft, action: MasterDataSaveAction, actorId: string) {
  const [existing] = await tx.select<Record<string, unknown>>('SELECT * FROM target_costs WHERE id = ?', [id])
  if (existing?.deleted_at != null)
    throw targetCostProblem('not-found', '预算版本已删除，请先恢复')
  const values = normalizeTargetCostHeader(draft, action, String(existing?.status ?? 'draft'))
  if (values.project_id && !(await tx.select(selectVisibleSql('projects', 'AND id = ?'), [values.project_id]))[0])
    throw targetCostProblem('relationship-mismatch', '所选项目不存在或已删除', { projectId: ['请重新选择有效项目'] })
  const affected = [id]
  const timestamp = new Date().toISOString()
  if (values.is_baseline && values.project_id) {
    const previous = await tx.select<{ id: string }>(selectVisibleSql('target_costs', 'AND project_id = ? AND is_baseline = 1 AND id <> ?'), [values.project_id, id])
    for (const row of previous) {
      await withUpdateLog(tx, 'target_costs', row.id, () => tx.execute('UPDATE target_costs SET is_baseline = 0, updated_at = ? WHERE id = ?', [timestamp, row.id]), actorId)
      affected.push(row.id)
    }
  }
  const columns = Object.keys(values)
  if (existing) {
    await withUpdateLog(tx, 'target_costs', id, () => tx.execute(`UPDATE target_costs SET ${columns.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...Object.values(values), timestamp, id]), actorId)
  }
  else {
    await tx.execute(`INSERT INTO target_costs(id, ${columns.join(', ')}, created_at, updated_at) VALUES (?, ${columns.map(() => '?').join(', ')}, ?, ?)`, [id, ...Object.values(values), timestamp, timestamp])
    await logCreate(tx, 'target_costs', id, actorId)
  }
  return affected
}
