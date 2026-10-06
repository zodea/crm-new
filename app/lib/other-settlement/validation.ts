import type { OtherSettlementCommand, OtherSettlementDraft } from './contract'
import { isISODateDTO } from '../../types/read-model'
import { auxiliaryProblem } from '../auxiliary-contract/contract'
import { isExpenseClearanceAllocationInput, isExpenseClearanceLinkEdit } from '../finance/clearance-verification'

export function decodeOtherSettlementDraft(input: unknown): OtherSettlementDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw auxiliaryProblem('validation-failed', '结算资料无效')
  const raw = input as Record<string, unknown>
  if (raw.clearanceLinkEdit !== undefined) {
    if (typeof raw.id !== 'string' || !raw.id || Object.keys(raw).some(key => !['id', 'clearanceLinkEdit'].includes(key)) || !isExpenseClearanceLinkEdit(raw.clearanceLinkEdit))
      throw auxiliaryProblem('validation-failed', '旧份额补充采用只接受已保存结算的明确稳定关系。')
    return { id: raw.id, clearanceLinkEdit: raw.clearanceLinkEdit }
  }
  const strings = ['id', 'no', 'name', 'projectId', 'contractId', 'supplierId', 'settlementDate', 'settlementType', 'period', 'deductionNote', 'note', 'status', 'payeeSupplierId', 'payeeWorkerId', 'payeeNameSnapshot']
  if (Object.keys(raw).some(key => ![...strings, 'totalAmount', 'taxRate', 'originalExpenses'].includes(key)))
    throw auxiliaryProblem('validation-failed', '结算不接受明细或派生累计金额')
  const draft: OtherSettlementDraft = {}
  for (const key of strings) {
    const value = raw[key]
    if (value == null)
      continue
    if (typeof value !== 'string' || value.length > 10000)
      throw auxiliaryProblem('validation-failed', '结算字段无效', { [key]: ['请输入有效文本'] })
    Object.assign(draft, { [key]: value.trim() })
  }
  if (raw.originalExpenses !== undefined) {
    if (!Array.isArray(raw.originalExpenses) || raw.originalExpenses.length > 1000)
      throw auxiliaryProblem('validation-failed', '原费用采用必须来自真实费用行')
    draft.originalExpenses = raw.originalExpenses.map((line) => {
      if (!line || typeof line !== 'object' || Array.isArray(line) || Object.keys(line).some(key => !['amount', 'originalExpenseLineId', 'sourceRevision', 'sourceVersion', 'clearanceAllocations'].includes(key))
        || ['originalExpenseLineId', 'sourceVersion', 'sourceRevision'].some(key => typeof line[key] !== 'string' || !line[key].trim())
        || !(line.amount === null || (typeof line.amount === 'number' && Number.isFinite(line.amount) && line.amount >= 0 && line.amount <= 1e12 && Math.abs(line.amount * 100 - Math.round(line.amount * 100)) < 0.001))) {
        throw auxiliaryProblem('validation-failed', '原费用行身份、来源版本或采用金额无效')
      }
      if (line.clearanceAllocations !== undefined && (!Array.isArray(line.clearanceAllocations) || line.clearanceAllocations.length > 1000 || !line.clearanceAllocations.every(isExpenseClearanceAllocationInput) || new Set(line.clearanceAllocations.map((item: { itemId: string }) => item.itemId)).size !== line.clearanceAllocations.length))
        throw auxiliaryProblem('validation-failed', '旧份额采用必须明确选择真实核定份额，不能重复或猜关联。')
      return { originalExpenseLineId: line.originalExpenseLineId, sourceVersion: line.sourceVersion, sourceRevision: line.sourceRevision, amount: line.amount, ...(line.clearanceAllocations ? { clearanceAllocations: line.clearanceAllocations } : {}) }
    })
    if (new Set(draft.originalExpenses.map(line => line.originalExpenseLineId)).size !== draft.originalExpenses.length)
      throw auxiliaryProblem('validation-failed', '同一原费用行不可重复采用')
  }
  if (draft.payeeSupplierId && draft.payeeWorkerId)
    throw auxiliaryProblem('validation-failed', '实际收款分供方和工人身份必须互斥')
  for (const key of ['totalAmount', 'taxRate'] as const) {
    const value = raw[key]
    if (value == null) {
      draft[key] = null
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'taxRate' ? 100 : 1e12) || Math.abs(value * 100 - Math.round(value * 100)) > 0.001)
      throw auxiliaryProblem('validation-failed', '金额或税率无效', { [key]: ['请输入非负且最多两位小数的数值'] })
    draft[key] = value
  }
  if (draft.settlementDate && !isISODateDTO(draft.settlementDate))
    throw auxiliaryProblem('validation-failed', '结算日期无效', { settlementDate: ['请输入真实日期'] })
  if (draft.settlementType && !['过程结算', '完工结算', '零星用工'].includes(draft.settlementType))
    throw auxiliaryProblem('validation-failed', '结算类型无效')
  return draft
}
export function decodeOtherSettlementCommand(input: unknown): OtherSettlementCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw auxiliaryProblem('validation-failed', '结算命令无效')
  const raw = input as OtherSettlementCommand
  if (![raw.workspaceId, raw.actorId, raw.commandId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 240)
    || !['draft', 'save', 'submit', 'confirm'].includes(raw.action) || !(raw.baseVersion === null || typeof raw.baseVersion === 'string')
    || (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id)) || !raw.attachments || typeof raw.attachments !== 'object' || Array.isArray(raw.attachments)) {
    throw auxiliaryProblem('validation-failed', '结算命令身份、版本或附件无效')
  }
  const draft = decodeOtherSettlementDraft(raw.draft)
  if (draft.clearanceLinkEdit && (raw.action !== 'save' || !raw.id || Object.values(raw.attachments).some(value => !Array.isArray(value) || value.length > 0)))
    throw auxiliaryProblem('validation-failed', '已冻结结算补充采用不能混入正文、附件或其他动作。')
  if (draft.id && draft.id !== raw.id)
    throw auxiliaryProblem('relationship-mismatch', '结算身份不匹配')
  return { ...raw, draft }
}
