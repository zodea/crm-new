import type { TransactionDb } from '../db/coordinator'
import type { QuantityTemplateAction } from './central-contract'
import type { QuantityTemplateDraft } from './template'
import { selectVisibleSql } from '../db/soft-delete'
import { quantityProblem } from './central-contract'
import { deleteQuantityTemplate, loadQuantityTemplateWorkspace, persistQuantityTemplate, undoQuantityTemplateOperations } from './template'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(row: Record<string, unknown>, keys: string[]) {
  return keys.every(key => typeof row[key] === 'string')
}

function nullableStrings(row: Record<string, unknown>, keys: string[]) {
  return keys.every(key => row[key] === null || typeof row[key] === 'string')
}

function optionalStrings(row: Record<string, unknown>, keys: string[]) {
  return keys.every(key => row[key] === undefined || row[key] === null || typeof row[key] === 'string')
}

function quantity(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function templateDraft(value: unknown): value is QuantityTemplateDraft {
  return object(value) && strings(value, ['projectId', 'code', 'name'])
    && nullableStrings(value, ['id', 'copiedFromTemplateId', 'expectedUpdatedAt'])
    && Number.isFinite(value.sortOrder)
    && (value.allowArchivedEdit === undefined || typeof value.allowArchivedEdit === 'boolean')
    && Array.isArray(value.rooms) && value.rooms.every(row => object(row)
      && strings(row, ['key', 'code', 'name']) && nullableStrings(row, ['id'])
      && optionalStrings(row, ['sourceRoomId']) && ['room', 'whole_unit'].includes(String(row.kind)) && Number.isFinite(row.sortOrder))
    && Array.isArray(value.newItems) && value.newItems.every(row => object(row)
      && strings(row, ['key', 'code', 'name', 'section', 'trade', 'unit']) && Number.isFinite(row.sortOrder))
    && Array.isArray(value.lines) && value.lines.every(row => object(row)
      && strings(row, ['key', 'roomKey', 'itemId', 'fieldFormula', 'note']) && nullableStrings(row, ['id'])
      && optionalStrings(row, ['sourceLineId', 'sourceRoomId', 'sourceItemId', 'boqLineId']) && Number.isFinite(row.sortOrder)
      && (row.boqLineId == null || (typeof row.boqLineId === 'string' && Boolean(row.boqLineId.trim())))
      && ['recognizedContractQty', 'contractQty', 'provisionalQty', 'fieldQty'].every(key => quantity(row[key])))
}

export function parseQuantityTemplateAction(value: unknown): QuantityTemplateAction | null {
  if (!object(value))
    return null
  if (value.kind === 'save-template') {
    if (!templateDraft(value.draft))
      throw quantityProblem('validation-failed', '户型模板草稿格式无效，请重新核对输入')
    return { kind: value.kind, draft: value.draft }
  }
  if (value.kind === 'delete-template') {
    if (typeof value.templateId !== 'string' || !value.templateId.trim() || typeof value.allowArchivedEdit !== 'boolean')
      throw quantityProblem('validation-failed', '删除户型模板的请求格式无效')
    return { kind: value.kind, templateId: value.templateId, allowArchivedEdit: value.allowArchivedEdit }
  }
  if (value.kind === 'undo-template') {
    if (typeof value.allowArchivedEdit !== 'boolean' || !Array.isArray(value.logIds) || !value.logIds.length || !value.logIds.every(id => typeof id === 'string' && id.trim()))
      throw quantityProblem('validation-failed', '户型模板撤回记录无效')
    return { kind: value.kind, logIds: [...value.logIds] as string[], allowArchivedEdit: value.allowArchivedEdit }
  }
  return null
}

export async function validateQuantityTemplateParent(db: TransactionDb, projectId: string, action: QuantityTemplateAction) {
  if (action.kind === 'undo-template') {
    const [project] = await db.select<{ matrix_archived_at: string | null }>(selectVisibleSql('projects', 'AND id = ?'), [projectId])
    if (!project)
      throw quantityProblem('not-found', '工程量项目不存在或已删除')
    if (project.matrix_archived_at && !action.allowArchivedEdit)
      throw quantityProblem('validation-failed', '工程量矩阵已归档，请二次确认后再撤回模板操作')
    return
  }
  if (action.kind !== 'save-template')
    return
  if (action.draft.projectId !== projectId)
    throw quantityProblem('relationship-mismatch', '户型模板草稿不属于当前项目')
  if (action.draft.id) {
    const workspace = await loadQuantityTemplateWorkspace(db, projectId)
    const current = workspace.templates.find(row => row.id === action.draft.id)
    if (!current)
      throw quantityProblem('relationship-mismatch', '户型模板不存在或不属于当前项目')
    if (current.copiedFromTemplateId !== action.draft.copiedFromTemplateId)
      throw quantityProblem('validation-failed', '借用来源仅能在创建模板时确定')
    // 已保存副本独立于来源的当前可见性；后续只按自身身份编辑，不能再次夹带复制来源草稿。
    if (action.draft.rooms.some(row => row.sourceRoomId)
      || action.draft.lines.some(row => row.sourceLineId || row.sourceRoomId || row.sourceItemId)) {
      throw quantityProblem('validation-failed', '已保存模板不能重新指定复制来源明细')
    }
    return
  }
  if (action.draft.copiedFromTemplateId) {
    const workspace = await loadQuantityTemplateWorkspace(db, projectId)
    if (!workspace.templates.some(row => row.id === action.draft.copiedFromTemplateId))
      throw quantityProblem('relationship-mismatch', '借用来源模板不存在或已删除')
    for (const line of action.draft.lines) {
      if (!line.sourceLineId)
        continue
      const source = workspace.lines.find(row => row.id === line.sourceLineId)
      if (!source || ((line.boqLineId === undefined || line.boqLineId === source.boqLineId) && source.recognizedContractQty !== line.recognizedContractQty))
        throw quantityProblem('stale-source', '借用来源的认可合同量已变化，请重新读取后核对')
    }
  }
}

export async function persistQuantityTemplateAction(db: TransactionDb, projectId: string, action: QuantityTemplateAction, boqLines?: readonly { id: string, qty: number | null }[]): Promise<{ id: string, logIds: string[] }> {
  if (action.kind === 'save-template') {
    const saved = await persistQuantityTemplate(db, action.draft, { boqLines })
    return { id: saved.templateId, logIds: saved.logIds }
  }
  if (action.kind === 'delete-template') {
    const logId = await deleteQuantityTemplate(db, projectId, action.templateId, { allowArchivedEdit: action.allowArchivedEdit })
    return { id: action.templateId, logIds: [logId] }
  }
  await undoQuantityTemplateOperations(db, projectId, action.logIds)
  return { id: projectId, logIds: [] }
}
