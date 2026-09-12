import type { BudgetActualSource } from '../../server/utils/target-cost-actual'
import { describe, expect, it } from 'vitest'
import { aggregateTargetCostActual, buildTargetCostComparison } from '../../server/utils/target-cost-actual'

function paymentSource(overrides: Partial<BudgetActualSource> = {}): BudgetActualSource {
  return {
    id: 'confirmed-payments',
    version: 'source-v1',
    metric: 'paidAmount',
    categories: ['专业分包'],
    status: 'complete',
    rows: [{ identity: 'payment-1:allocation-1', projectId: 'project-budget', category: '专业分包', amount: null }],
    ...overrides,
  }
}

describe('中央预算实际来源的金额完整度与身份', () => {
  it('唯一支付金额未知时没有可展示的已知零；明确零支付仍是完整零', () => {
    const unknown = aggregateTargetCostActual('project-budget', [paymentSource()])
    expect(unknown.categories.find(row => row.category === '专业分包')?.paidAmount).toMatchObject({
      value: null,
      knownValue: null,
      status: 'pending',
    })

    const explicitZero = aggregateTargetCostActual('project-budget', [paymentSource({
      rows: [{ identity: 'payment-1:allocation-1', projectId: 'project-budget', category: '专业分包', amount: 0 }],
    })])
    expect(explicitZero.categories.find(row => row.category === '专业分包')?.paidAmount).toMatchObject({
      value: 0,
      knownValue: 0,
      status: 'complete',
    })
  })

  it('同一支付分摊被映射到两个科目时保持关系未知，不能分别计入两笔成本', () => {
    const facts = aggregateTargetCostActual('project-budget', [paymentSource({
      categories: ['专业分包', '合同劳务'],
      rows: [
        { identity: 'payment-1:allocation-1', projectId: 'project-budget', category: '专业分包', amount: 300 },
        { identity: 'payment-1:allocation-1', projectId: 'project-budget', category: '合同劳务', amount: 300 },
      ],
    })])
    for (const category of ['专业分包', '合同劳务']) {
      expect(facts.categories.find(row => row.category === category)?.paidAmount).toMatchObject({
        value: null,
        knownValue: null,
        status: 'pending',
      })
    }
  })

  it('合同与结算展示的同一支付只计一次，独立分摊可累计，未知部分与无权来源不填数', () => {
    const first = { identity: 'payment-1:allocation-1', projectId: 'project-budget', category: '专业分包' as const, amount: 300 }
    const facts = aggregateTargetCostActual('project-budget', [
      paymentSource({ id: 'contract-payments', rows: [first] }),
      paymentSource({ id: 'settlement-payments', rows: [
        first,
        { ...first, identity: 'payment-1:allocation-2', amount: 200 },
        { ...first, identity: 'payment-2:allocation-3', amount: null },
        { ...first, projectId: 'unrelated-project', amount: 9999 },
      ] }),
      paymentSource({ id: 'unreadable-payments', status: 'forbidden', rows: [{ ...first, amount: 8888 }] }),
    ])
    const actual = facts.categories.find(row => row.category === '专业分包')!.paidAmount
    expect(actual).toMatchObject({ value: null, knownValue: 500, status: 'partial' })
    expect(actual.missingSources).toEqual(expect.arrayContaining([
      'settlement-payments:金额或归属未确定',
      'unreadable-payments:forbidden',
    ]))
  })

  it('实际成本只知道一部分时不把合同额当成本，也不推算完整剩余预算', () => {
    const facts = aggregateTargetCostActual('project-budget', [
      paymentSource({ id: 'contracts', metric: 'signedAmount', rows: [
        { identity: 'contract-1', projectId: 'project-budget', category: '专业分包', amount: 9900 },
      ] }),
      paymentSource({ id: 'settlements', metric: 'settledAmount', rows: [
        { identity: 'settlement-1', projectId: 'project-budget', category: '专业分包', amount: 700 },
        { identity: 'settlement-2', projectId: 'project-budget', category: '专业分包', amount: null },
      ] }),
    ])
    const comparison = buildTargetCostComparison('budget-a', [{
      id: 'item-1',
      category: '专业分包',
      itemName: '外墙',
      unit: '',
      qty: null,
      unitPrice: null,
      amount: 1500,
      note: '',
      sortOrder: 0,
    }], facts)
    expect(comparison.categories.find(row => row.category === '专业分包')).toMatchObject({
      targetAmount: 1500,
      signedAmount: { value: 9900 },
      settledAmount: { value: null, knownValue: 700, status: 'partial' },
      remainingAmount: { value: null, knownValue: null },
    })
    expect(comparison.summary).toMatchObject({
      itemTotal: 1500,
      settledAmount: { value: null, knownValue: 700 },
      remainingAmount: { value: null, knownValue: null },
    })
  })

  it('五类合同读取完整时已签合计可核对，工资和报销未接成本不伪造成缺失合同', () => {
    const facts = aggregateTargetCostActual('project-budget', [paymentSource({
      id: 'all-contracts',
      metric: 'signedAmount',
      categories: ['专业分包', '合同劳务', '材料', '机械', '其他'],
      rows: [
        { identity: 'contract-material', projectId: 'project-budget', category: '材料', amount: 800 },
        { identity: 'contract-labour', projectId: 'project-budget', category: '合同劳务', amount: 200 },
      ],
    })])
    for (const category of ['工人工资', '费用报销']) {
      expect(facts.categories.find(row => row.category === category)?.signedAmount).toMatchObject({ value: null, knownValue: null, status: 'not-applicable' })
      expect(facts.categories.find(row => row.category === category)?.settledAmount).toMatchObject({ value: null, knownValue: null, status: 'pending' })
    }
    const comparison = buildTargetCostComparison('budget-a', [], facts)
    expect(comparison.summary.signedAmount).toMatchObject({ value: 1000, knownValue: 1000, status: 'complete' })
    expect(comparison.summary.settledAmount.value).toBeNull()
  })

  it('个别科目余额可计算时，项目总余额仍不把其他缺失科目按零合并', () => {
    const facts = aggregateTargetCostActual('project-budget', [paymentSource({
      id: 'subcontract-settlements',
      metric: 'settledAmount',
      categories: ['专业分包'],
      rows: [{ identity: 'settlement-known', projectId: 'project-budget', category: '专业分包', amount: 200 }],
    })])
    const comparison = buildTargetCostComparison('budget-a', [
      { id: 'item-subcontract', category: '专业分包', itemName: '外墙', unit: '', qty: null, unitPrice: null, amount: 1000, note: '', sortOrder: 0 },
      { id: 'item-material', category: '材料', itemName: '电线', unit: '', qty: null, unitPrice: null, amount: 500, note: '', sortOrder: 1 },
    ], facts)
    expect(comparison.categories.find(row => row.category === '专业分包')?.remainingAmount).toMatchObject({ value: 800, knownValue: 800, status: 'complete' })
    expect(comparison.summary.remainingAmount).toMatchObject({ value: null, knownValue: null, status: 'pending' })
  })
})
