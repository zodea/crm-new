import type { AuxiliaryContractCommand, AuxiliaryContractDraft } from './contract'
import { isISODateDTO } from '../../types/read-model'
import { AUXILIARY_CATEGORIES, auxiliaryKind, auxiliaryProblem } from './contract'

const TEXT_FIELDS = ['id', 'no', 'name', 'projectId', 'supplierId', 'category', 'counterparty', 'partyA', 'signDate', 'servicePeriod', 'invoiceType', 'paymentCycle', 'mainTerms', 'status', 'note'] as const
export function decodeAuxiliaryDraft(value: unknown): AuxiliaryContractDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw auxiliaryProblem('validation-failed', '合同资料格式不正确')
  const raw = value as Record<string, unknown>
  const kind = auxiliaryKind(raw.kind)
  if (Object.keys(raw).some(key => ![...TEXT_FIELDS, 'kind', 'amount', 'taxRate'].includes(key)))
    throw auxiliaryProblem('validation-failed', '辅助合同不接受额外关系或合同明细')
  const draft: AuxiliaryContractDraft = { kind }
  for (const field of TEXT_FIELDS) {
    const entry = raw[field]
    if (entry == null)
      continue
    if (typeof entry !== 'string' || entry.length > 10000)
      throw auxiliaryProblem('validation-failed', '合同文本格式不正确', { [field]: ['请输入有效文本'] })
    Object.assign(draft, { [field]: entry.trim() })
  }
  for (const field of ['amount', 'taxRate'] as const) {
    const entry = raw[field]
    if (entry == null) {
      draft[field] = null
      continue
    }
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > (field === 'taxRate' ? 100 : 1e12)
      || Math.abs(entry * 100 - Math.round(entry * 100)) > 0.001) {
      throw auxiliaryProblem('validation-failed', '金额或税率无效', { [field]: ['请输入非负、最多两位小数的有效数值'] })
    }
    draft[field] = entry
  }
  if (draft.signDate && !isISODateDTO(draft.signDate))
    throw auxiliaryProblem('validation-failed', '签订日期无效', { signDate: ['请输入真实日期'] })
  if (kind === 'company_expense' && (draft.projectId || draft.supplierId))
    throw auxiliaryProblem('validation-failed', '公司合同不能挂项目或项目分供方')
  if (kind === 'other_expense' && draft.counterparty)
    throw auxiliaryProblem('validation-failed', '其他支出合同必须使用真实分供方')
  if (draft.category && !AUXILIARY_CATEGORIES[kind].includes(draft.category))
    throw auxiliaryProblem('validation-failed', '合同类别无效', { category: ['请选择该类型的合同类别'] })
  if (draft.paymentCycle && !['月', '季', '年', '一次性'].includes(draft.paymentCycle))
    throw auxiliaryProblem('validation-failed', '付款周期无效')
  return draft
}
export function decodeAuxiliaryCommand(value: unknown): AuxiliaryContractCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw auxiliaryProblem('validation-failed', '写入请求无效')
  const raw = value as AuxiliaryContractCommand
  if (![raw.workspaceId, raw.actorId, raw.commandId].every(entry => typeof entry === 'string' && entry.length > 0 && entry.length <= 240)
    || !['draft', 'save', 'submit'].includes(raw.action)
    || !(raw.baseVersion === null || typeof raw.baseVersion === 'string')
    || (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id))) {
    throw auxiliaryProblem('validation-failed', '写入命令身份或版本无效')
  }
  if (!raw.attachments || typeof raw.attachments !== 'object' || Array.isArray(raw.attachments))
    throw auxiliaryProblem('validation-failed', '附件变更格式无效')
  const draft = decodeAuxiliaryDraft(raw.draft)
  if (draft.id && draft.id !== raw.id)
    throw auxiliaryProblem('validation-failed', '合同 ID 与命令目标不一致')
  return { ...raw, draft }
}
