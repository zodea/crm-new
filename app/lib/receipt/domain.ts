import type { ReceiptAction, ReceiptDraft, ReceiptReferenceFacts } from './contract'
import { isISODateDTO } from '../../types/read-model'
import { coreMigrationMoneyToCents, isCoreMigrationMoney } from '../migration/core-contract'
import { receiptProblem } from './contract'

const TEXT_FIELDS = ['no', 'receiptDate', 'payerAccount', 'paymentMethod', 'acceptanceBillNo', 'billDueDate', 'periodNo', 'bankSerialNo', 'handler', 'reviewStatus', 'note'] as const
const REFERENCE_FIELDS = ['projectId', 'contractId', 'customerId'] as const

/** 验证用户输入；金额始终保留分精度，草稿缺值不会转成已知零。 */
export function validateReceiptDraft(input: ReceiptDraft, action: ReceiptAction, references: ReceiptReferenceFacts): ReceiptDraft {
  const errors: Record<string, string[]> = {}
  const draft = { ...input }
  for (const field of TEXT_FIELDS) {
    if (typeof input[field] !== 'string')
      errors[field] = ['必须为文本']
    else draft[field] = input[field].trim()
  }
  for (const field of REFERENCE_FIELDS) {
    if (input[field] !== null && typeof input[field] !== 'string')
      errors[field] = ['必须为有效记录编号或空值']
    else draft[field] = input[field]?.trim() || null
  }
  for (const field of ['receiptDate', 'billDueDate'] as const) {
    if (draft[field] && !isISODateDTO(draft[field]))
      errors[field] = ['请输入真实有效的日期']
  }
  if (draft.amount !== null && (!isCoreMigrationMoney(draft.amount) || coreMigrationMoneyToCents(draft.amount) < BigInt(0)))
    errors.amount = ['金额必须是安全范围内的非负两位小数']
  const project = references.projects.find(row => row.id === draft.projectId)
  const customer = references.customers.find(row => row.id === draft.customerId)
  const contract = references.contracts.find(row => row.id === draft.contractId)
  if (draft.projectId && !project)
    errors.projectId = ['项目不存在、已删除或不可读']
  if (draft.customerId && !customer)
    errors.customerId = ['付款方客户不存在、已删除或不可读']
  if (project && draft.customerId && project.customerId !== draft.customerId)
    errors.customerId = ['付款方客户必须是所选项目的主客户']
  if (draft.contractId) {
    if (!contract)
      errors.contractId = ['施工合同不存在、已删除或不可读']
    else if (contract.projectId !== draft.projectId || (draft.customerId && contract.customerId && contract.customerId !== draft.customerId))
      errors.contractId = ['施工合同必须属于所选项目和付款方客户']
  }
  if (action !== 'draft') {
    if (!draft.receiptDate)
      errors.receiptDate = ['请填写收款日期']
    if (!draft.projectId)
      errors.projectId = ['请选择项目']
    if (!draft.customerId)
      errors.customerId = ['请选择付款方客户']
    if (draft.amount === null || (!errors.amount && coreMigrationMoneyToCents(draft.amount) <= BigInt(0)))
      errors.amount = ['收款金额必须大于 0']
  }
  if (Object.keys(errors).length)
    throw receiptProblem('validation-failed', '收款信息不完整或无效，请修正后重试', errors)
  return draft
}
