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

  it('项目列表使用正式收入与当前目标成本，二者不由合同额替代', () => {
    expect(summarizeProjectFinance({ income: 25367027, budget: 28600000 }))
      .toEqual({ income: 25367027, budget: 28600000 })
  })
})
