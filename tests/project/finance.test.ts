import { describe, expect, it } from 'vitest'
import { summarizeProjectFinance } from '~/lib/project/finance'

describe('项目列表金额列取值', () => {
  it('无详情聚合时，预算总额回退合同金额（万元）换算为元', () => {
    expect(summarizeProjectFinance({ contractAmount: 3238.84 }))
      .toEqual({ income: 0, budget: 32388400 })
  })

  it('合同金额为空按 0 处理，不产出 NaN', () => {
    expect(summarizeProjectFinance({ contractAmount: null }))
      .toEqual({ income: 0, budget: 0 })
  })
})
