import type { Project } from '~/stores/project'

// 项目列表红圈金额列（累计收入 / 预算总额）的取值。设计稿 ProjectScreen.jsx 两列均为 money
// 口径（元）。真实来源是下方子表实时聚合（#65 经营数据面板），本骨架先给可解释占位；#65
// 落地后只需替换本函数体，列表列与格式化无需改（单一取值口径，避免列表内联占位逻辑漂移）。

export interface ProjectFinanceSummary {
  /** 累计收入（元）：Σ 收款登记.收款金额。 */
  income: number
  /** 预算总额（元）：成本预算表未建前，采用主合同额。 */
  budget: number
}

export interface ProjectFinanceAggregate {
  income: number
  mainContractAmount: number
}

/** 合同金额以万元存储（seed 与「合同金额（万元）」列口径），金额列换算为元展示。 */
const YUAN_PER_WAN = 10000

export function summarizeProjectFinance(
  project: Pick<Project, 'contractAmount'>,
  aggregate?: ProjectFinanceAggregate,
): ProjectFinanceSummary {
  return {
    income: aggregate?.income ?? 0,
    budget: aggregate?.mainContractAmount ?? (project.contractAmount ?? 0) * YUAN_PER_WAN,
  }
}
