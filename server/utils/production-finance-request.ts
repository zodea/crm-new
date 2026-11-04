import type { CentralFinanceKind, FinanceCommand } from '../../app/lib/finance/central-contract'
import { createHash } from 'node:crypto'
import { decodeConstructionMainSelection } from '../../app/lib/construction-scope/contract'
import { CENTRAL_FINANCE_KINDS, FINANCE_FAMILIES, financeFailure } from '../../app/lib/finance/central-contract'
import { isExpenseClearanceVerificationEdit } from '../../app/lib/finance/clearance-verification'
import { parsePaymentContractReference } from '../../app/lib/finance/payment-contract'
import { isPaymentVerificationEdit } from '../../app/lib/finance/payment-verification'

export function financeCanonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(financeCanonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${financeCanonical(Reflect.get(value, key))}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const financeCommandFingerprint = (value: unknown) => createHash('sha256').update(financeCanonical(value)).digest('hex')

export function financeKind(value: unknown): CentralFinanceKind {
  if (!CENTRAL_FINANCE_KINDS.includes(value as CentralFinanceKind))
    financeFailure('validation-failed', '财务表单类型无效。')
  return value as CentralFinanceKind
}
export function financeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][\w-]{2,99}$/i.test(value))
    financeFailure('validation-failed', '财务稳定编号无效。')
  return value
}
export function assertFinanceFinite(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    financeFailure('validation-failed', '财务金额或数值无效，不能把未知数值转换为零。')
  if (Array.isArray(value))
    value.forEach(assertFinanceFinite)
  else if (value && typeof value === 'object')
    Object.values(value).forEach(assertFinanceFinite)
}
export function parseFinanceCommand(value: unknown): FinanceCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    financeFailure('validation-failed', '缺少财务原提交。')
  const body = value as Record<string, unknown>
  const allowed = ['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'kind', 'id', 'baseVersion', 'action', 'draft', 'attachments']
  if (Object.keys(body).some(key => !allowed.includes(key)))
    financeFailure('validation-failed', '财务命令包含不支持的字段。')
  const kind = financeKind(body.kind)
  financeId(body.commandId)
  if (body.id !== undefined)
    financeId(body.id)
  if (typeof body.workspaceId !== 'string' || !body.workspaceId || typeof body.actorId !== 'string' || !body.actorId
    || body.requiredCapability !== `${FINANCE_FAMILIES[kind]}:write`
    || !(body.baseVersion === null || (typeof body.baseVersion === 'string' && /^[1-9]\d*$/.test(body.baseVersion)))
    || !['draft', 'save', 'submit', 'confirm', 'unconfirm', 'delete'].includes(String(body.action))
    || !body.draft || typeof body.draft !== 'object' || Array.isArray(body.draft)
    || !body.attachments || typeof body.attachments !== 'object' || Array.isArray(body.attachments)) {
    financeFailure('validation-failed', '财务原提交身份、版本或内容不完整。')
  }
  if ((body.action === 'confirm' || body.action === 'unconfirm') && kind !== 'payment_record')
    financeFailure('validation-failed', '只有实际支付记录支持确认或撤回确认。')
  if (['unconfirm', 'delete'].includes(String(body.action)) && !body.id)
    financeFailure('validation-failed', '此操作缺少已存在财务记录的稳定编号。')
  const draft = body.draft as Record<string, unknown>
  if (draft.contractReference != null && (kind !== 'payment_application' || !parsePaymentContractReference(draft.contractReference)))
    financeFailure('validation-failed', '付款合同身份、领域或版本无效。')
  try {
    if (draft.constructionMain !== undefined) {
      if (kind !== 'reimbursement')
        financeFailure('validation-failed', '工程归属选择只适用实际原费用。')
      decodeConstructionMainSelection(draft.constructionMain)
    }
    if (kind === 'reimbursement' && Array.isArray(draft.lines)) {
      for (const line of draft.lines) {
        if (line && typeof line === 'object' && line.constructionMain !== undefined)
          decodeConstructionMainSelection(line.constructionMain)
      }
    }
  }
  catch { financeFailure('validation-failed', '工程名称必须搜索并选择真实施工主合同，不接受自由文本或未知依据。') }
  if (draft.clearanceVerificationEdit !== undefined && (kind !== 'reimbursement' || body.action !== 'save' || !body.id || !isExpenseClearanceVerificationEdit(draft.clearanceVerificationEdit) || Object.keys(draft).some(key => !['id', 'clearanceVerificationEdit'].includes(key)) || Object.values(body.attachments).some(value => !Array.isArray(value) || value.length > 0)))
    financeFailure('validation-failed', '旧清偿核定只采用已保存的原费用及原件，不能混入正文或附件变更。')
  if (draft.clearanceAttachmentsOnly !== undefined && (draft.clearanceAttachmentsOnly !== true || kind !== 'reimbursement' || body.action !== 'save' || !body.id || Object.keys(draft).some(key => !['id', 'clearanceAttachmentsOnly'].includes(key)) || Object.keys(body.attachments).some(key => !['add'].includes(key))))
    financeFailure('validation-failed', '替代依据原件仅可追加到已保存原费用，不能改写原正文或删除历史原件。')
  if (draft.verificationEdit !== undefined && (kind !== 'payment_application' || body.action !== 'save' || !body.id
    || !isPaymentVerificationEdit(draft.verificationEdit) || Object.keys(draft).some(key => !['id', 'verificationEdit'].includes(key))
    || Object.values(body.attachments).some(value => !Array.isArray(value) || value.length > 0))) {
    financeFailure('validation-failed', '业务核验只采用已保存的付款申请及原件，不能混入未保存正文或附件变更。')
  }
  if (draft.id !== undefined && draft.id !== body.id)
    financeFailure('validation-failed', '财务正文与命令目标不一致。')
  assertFinanceFinite(body)
  return body as unknown as FinanceCommand
}
