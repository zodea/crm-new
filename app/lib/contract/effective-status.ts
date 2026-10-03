import { visibleCond } from '../db/soft-delete'

const CONFIRMED_SETTLEMENT_STATUSES: readonly string[] = ['confirmed', '已确认']
const INEFFECTIVE_EXPENDITURE_CONTRACT_STATUSES: readonly string[] = ['draft', '草稿', '无效', '作废', 'cancelled']

/** 固定领域枚举生成的 SQL 值列表，不接受外部输入。 */
export const CONFIRMED_SETTLEMENT_SQL_VALUES = CONFIRMED_SETTLEMENT_STATUSES.map(status => `'${status}'`).join(', ')
export const INEFFECTIVE_EXPENDITURE_CONTRACT_SQL_VALUES = INEFFECTIVE_EXPENDITURE_CONTRACT_STATUSES.map(status => `'${status}'`).join(', ')

/** 支出合同保留全部状态供追溯，只有有效合同进入分供方金额汇总。 */
export function isEffectiveExpenditureContract(status: string): boolean {
  return !INEFFECTIVE_EXPENDITURE_CONTRACT_STATUSES.includes(status)
}

/** 调用方须为 contract_supplements 登记隐藏祖先 CTE；别名仅由仓库查询传入。 */
export function effectiveExpenditureSupplementAmountSql(contractAlias: string): string {
  return `COALESCE((
    SELECT SUM(supplement.amount)
    FROM contract_supplements AS supplement
    WHERE supplement.contract_id = ${contractAlias}.id
      AND ${visibleCond('contract_supplements', 'supplement')}
      AND supplement.status NOT IN (${INEFFECTIVE_EXPENDITURE_CONTRACT_SQL_VALUES})
  ), 0)`
}

/** 审批通过不等于结算确认，跨页汇总统一只计已确认结算。 */
export function isConfirmedExpenditureSettlement(status: string): boolean {
  return CONFIRMED_SETTLEMENT_STATUSES.includes(status)
}
