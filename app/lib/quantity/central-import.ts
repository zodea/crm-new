import type { TransactionDb } from '../db/coordinator'
import type { QuantityCommandResult } from './central-contract'
import type { QuantityImportAction } from './import-contract'
import { loadQuantityAssignmentWorkspace } from './assignment'
import { persistQuantityAssignmentAction, validateQuantityAssignmentParent } from './central-assignment-action'
import { parseQuantityCompletionAction, persistQuantityCompletionAction, validateQuantityCompletionParent } from './central-completion-action'
import { quantityProblem } from './central-contract'
import { persistQuantityTemplateAction, validateQuantityTemplateParent } from './central-template-action'
import { buildQuantityAssignmentImportDraft, buildQuantityCompletionImportDraft, buildQuantityTemplateImportDraft } from './import'
import { resolveQuantityImportAssignee, resolveQuantityImportUnit } from './import-contract'
import { loadQuantityRegionWorkspace } from './region'

/** 每次命令和重放均检查当前来源；真正草稿在版本门禁后构造，重放不会再生成新事实。 */
export async function validateQuantityImportParent(db: TransactionDb, projectId: string, action: QuantityImportAction) {
  const workspace = await loadQuantityRegionWorkspace(db, projectId)
  if (workspace.matrixArchivedAt)
    throw quantityProblem('validation-failed', '工程量矩阵已归档，请在工程量页面确认编辑，不能直接导入')
  if (action.target !== 'template' && resolveQuantityImportUnit(workspace, action.row) !== action.unitId)
    throw quantityProblem('relationship-mismatch', '导入行区域编码与当前目标户身份不一致')
  if (action.target === 'assignment') {
    const current = resolveQuantityImportAssignee((await loadQuantityAssignmentWorkspace(db, projectId)).assignees, action.row)
    if (current.kind !== action.assignee?.kind || current.id !== action.assignee.id)
      throw quantityProblem('relationship-mismatch', '导入行责任人与当前中央身份不一致，请重新核对')
  }
}

export async function persistQuantityImport(db: TransactionDb, projectId: string, action: QuantityImportAction, actorId: string, options: NonNullable<Parameters<typeof persistQuantityCompletionAction>[3]> = {}): Promise<Omit<QuantityCommandResult, 'commandId' | 'sourceVersion'>> {
  if (action.target === 'template') {
    const command = { kind: 'save-template' as const, draft: await buildQuantityTemplateImportDraft(db, projectId, action.row) }
    await validateQuantityTemplateParent(db, projectId, command)
    return persistQuantityTemplateAction(db, projectId, command)
  }
  if (action.target === 'assignment') {
    const command = { kind: 'save-assignments' as const, draft: await buildQuantityAssignmentImportDraft(db, projectId, action.unitId!, action.row, action.assignee!) }
    await validateQuantityAssignmentParent(db, projectId, command)
    return persistQuantityAssignmentAction(db, command)
  }
  const command = { kind: 'save-completion' as const, draft: await buildQuantityCompletionImportDraft(db, projectId, action.unitId!, action.row, options) }
  parseQuantityCompletionAction(command)
  await validateQuantityCompletionParent(db, projectId, command, options)
  try {
    return await persistQuantityCompletionAction(db, command, actorId, options)
  }
  catch (cause) {
    if (cause instanceof Error && /照片|责任/.test(cause.message))
      throw quantityProblem('validation-failed', `${cause.message}；可将状态明确填为 draft 导入草稿，再到户详情补齐责任和照片`)
    throw cause
  }
}
