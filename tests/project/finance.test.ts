import { describe, expect, it } from 'vitest'
import { summarizeProjectFinance } from '~/lib/project/finance'

describe('项目列表金额列取值', () => {
  it('无真实聚合时保持未知，不用合同金额冒充预算', () => {
    expect(summarizeProjectFinance())
      .toEqual({ income: null, budget: null })
  })

  it('保留真实的零值事实', () => {
    expect(summarizeProjectFinance({ income: 0, budget: 0 }))
      .toEqual({ income: 0, budget: 0 })
  })
})
