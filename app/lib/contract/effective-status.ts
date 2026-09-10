/** 支出合同保留全部状态供追溯，只有有效合同进入分供方金额汇总。 */
export function isEffectiveExpenditureContract(status: string): boolean {
  return !['draft', '草稿', '无效', '作废', 'cancelled'].includes(status)
}

/** 审批通过不等于结算确认，跨页汇总统一只计已确认结算。 */
export function isConfirmedExpenditureSettlement(status: string): boolean {
  return ['confirmed', '已确认'].includes(status)
}
