// 项目列表金额列只接受真实聚合事实。缺少收款汇总或当前目标成本基线时返回 null，
// 由表格显示「—」，不拿项目合同额冒充预算，也不把未知事实强制格式化为 0。

export interface ProjectFinanceSummary {
  /** 累计收入（元）：Σ 收款登记.收款金额。 */
  income: number | null
  /** 预算总额（元）：当前目标成本基线的含税总额。 */
  budget: number | null
}

export interface ProjectFinanceAggregate {
  income: number | null
  budget: number | null
}

export function summarizeProjectFinance(
  aggregate?: ProjectFinanceAggregate,
): ProjectFinanceSummary {
  return {
    income: aggregate?.income ?? null,
    budget: aggregate?.budget ?? null,
  }
}
