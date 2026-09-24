import type { OtherSettlementCommand, OtherSettlementDraft } from './contract'
import { isISODateDTO } from '../../types/read-model'
import { auxiliaryProblem } from '../auxiliary-contract/contract'

export function decodeOtherSettlementDraft(input: unknown): OtherSettlementDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw auxiliaryProblem('validation-failed', '结算资料无效')
  const raw = input as Record<string, unknown>
  const strings = ['id', 'no', 'name', 'projectId', 'contractId', 'supplierId', 'settlementDate', 'settlementType', 'period', 'deductionNote', 'note', 'status']
  if (Object.keys(raw).some(key => ![...strings, 'totalAmount', 'taxRate'].includes(key)))
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
  if (draft.id && draft.id !== raw.id)
    throw auxiliaryProblem('relationship-mismatch', '结算身份不匹配')
  return { ...raw, draft }
}
