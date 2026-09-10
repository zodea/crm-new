const CONFIRMED_SETTLEMENT_STATUSES: readonly string[] = ['confirmed', '已确认']

/** 固定领域枚举生成的 SQL 值列表，不接受外部输入。 */
export const CONFIRMED_SETTLEMENT_SQL_VALUES = CONFIRMED_SETTLEMENT_STATUSES.map(status => `'${status}'`).join(', ')

/** 支出合同保留全部状态供追溯，只有有效合同进入分供方金额汇总。 */
export function isEffectiveExpenditureContract(status: string): boolean {
  return !['draft', '草稿', '无效', '作废', 'cancelled'].includes(status)
}

/** 审批通过不等于结算确认，跨页汇总统一只计已确认结算。 */
export function isConfirmedExpenditureSettlement(status: string): boolean {
  return CONFIRMED_SETTLEMENT_STATUSES.includes(status)
}
