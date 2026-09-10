export type ApprovedAmountOrigin = 'legacy' | 'user-entry'
export type ApprovedAmountState = 'not-entered' | 'known' | 'legacy-unknown'

export interface ApprovedAmountEdit {
  value: number | null
}

export interface StoredApprovalAmount {
  approved_amount: number | null
  approved_amount_origin: ApprovedAmountOrigin
}

function nullableAmount(value: unknown): number | null {
  if (value === undefined || value === null)
    return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('批复金额必须为空或非负有效金额')
  return value
}

/** 来源只由保存域决定；整单保存和客户端来源字段不能确认旧零值的含义。 */
export function approvalAmountForSave(
  value: unknown,
  edit: ApprovedAmountEdit | undefined,
  existing?: StoredApprovalAmount | null,
): StoredApprovalAmount {
  if (edit !== undefined) {
    if (!edit || typeof edit !== 'object' || !Object.hasOwn(edit, 'value') || edit.value === undefined)
      throw new Error('批复金额修改缺少明确输入值')
    const entered = nullableAmount(edit.value)
    if (entered !== nullableAmount(value))
      throw new Error('批复金额与明确输入值不一致')
    return { approved_amount: entered, approved_amount_origin: 'user-entry' }
  }
  if (existing) {
    if (value !== undefined && nullableAmount(value) !== existing.approved_amount)
      throw new Error('修改批复金额需要明确输入')
    return existing
  }
  return { approved_amount: nullableAmount(value), approved_amount_origin: 'user-entry' }
}

/** 缺少旧来源的零不能作为真实批复零；展示与统计必须保留未知。 */
export function readApprovalAmount(value: number | null, origin?: ApprovedAmountOrigin) {
  nullableAmount(value)
  const state: ApprovedAmountState = value === null
    ? 'not-entered'
    : value === 0 && origin !== 'user-entry' ? 'legacy-unknown' : 'known'
  return { amount: state === 'known' ? value : null, state }
}

export function approvalPaymentCap(applyAmount: number, approvedAmount: number | null, origin?: ApprovedAmountOrigin): number | null {
  const approval = readApprovalAmount(approvedAmount, origin)
  return approval.state === 'legacy-unknown' ? null : approval.amount ?? applyAmount
}

/** PAY-08 待裁定：旧零保持既有确认兼容上限，此分支不把它升级为批复事实。 */
export function paymentConfirmationCap(applyAmount: number, approvedAmount: number | null, origin?: ApprovedAmountOrigin): number {
  return approvalPaymentCap(applyAmount, approvedAmount, origin) ?? applyAmount
}

export function approvalAmountLabel(state: ApprovedAmountState): string {
  return state === 'legacy-unknown' ? '历史批复待核验' : state === 'not-entered' ? '未填写' : '已填写'
}

export function isApprovalReadState(amount: unknown, state: unknown): boolean {
  return amount === null ? state === 'not-entered' || state === 'legacy-unknown' : state === 'known'
}
