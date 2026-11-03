import type { PayrollALine } from '~/lib/payroll/central-a-contract'
import type { PayrollAFeeLine, PayrollANegativeLineRevision } from '~/lib/payroll/central-a-fees-contract'
import { describe, expect, it } from 'vitest'
import { decodePayrollAWire, encodePayrollAWire } from '~/lib/payroll/central-a-codec'
import { calculatePayrollAItemRatios, carryPayrollARatioPlan, isPayrollARatioPlan } from '~/lib/payroll/central-a-item-ratio'

const work = (itemId: string, amount: number | null) => ({ itemId, itemName: itemId, amount }) as PayrollALine
const fee = (feeId: string, value: number | null) => ({ feeId, name: feeId, amount: { value, knownValue: value, state: value === null ? 'unknown' : 'known', reasons: [] } }) as PayrollAFeeLine
const negative = (lineId: string, signedAmountFen: number | null) => ({ lineId, signedAmountFen }) as PayrollANegativeLineRevision

describe('工资 A 类分项比例累计', () => {
  it('比例计划保留明确零值与未填写项，传输往返并拒绝重复或无效比例', () => {
    const plan = { schemaVersion: 1, itemRatios: [{ itemId: 'wall', ratio: 0 }, { itemId: 'floor', ratio: null }], feeRatios: [{ kind: 'fee', id: 'fee-1', ratio: 0.8 }] }
    expect(isPayrollARatioPlan(plan)).toBe(true)
    expect(decodePayrollAWire(encodePayrollAWire(plan))).toEqual(plan)
    expect(isPayrollARatioPlan({ ...plan, itemRatios: [plan.itemRatios[0], plan.itemRatios[0]] })).toBe(false)
    expect(isPayrollARatioPlan({ ...plan, feeRatios: [{ kind: 'fee', id: 'fee-1', ratio: -0.1 }] })).toBe(false)
  })

  it('上月仅按稳定分项与费用身份继承，新增工作必须单独填写', () => {
    const previous = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'wall', ratio: 0 }, { itemId: 'old', ratio: 0.7 }], feeRatios: [{ kind: 'fee' as const, id: 'housing', ratio: 0.9 }] }
    const result = carryPayrollARatioPlan({ periodKind: 'monthly', itemIds: ['wall', 'new-item'], feeIds: [{ kind: 'fee', id: 'housing' }], previous })
    expect(result.plan.itemRatios).toEqual([{ itemId: 'new-item', ratio: null }, { itemId: 'wall', ratio: 0 }])
    expect(result.plan.feeRatios).toEqual([{ kind: 'fee', id: 'housing', ratio: 0.9 }])
    expect(result.reasons).toEqual([])
  })

  it('人工更改优先，来源变化时提示核对；尾款强制 100%', () => {
    const previous = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'wall', ratio: 0.4 }], feeRatios: [] }
    const current = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'wall', ratio: 0.7 }, { itemId: 'removed', ratio: 0.2 }], feeRatios: [] }
    const result = carryPayrollARatioPlan({ periodKind: 'monthly', itemIds: ['wall'], feeIds: [], previous, current })
    expect(result.plan.itemRatios).toEqual([{ itemId: 'wall', ratio: 0.7 }, { itemId: 'removed', ratio: 0.2 }])
    expect(result.reasons).toContain('已填写的比例对应分项或费用已变化，请重新核对')
    expect(carryPayrollARatioPlan({ periodKind: 'retention', itemIds: ['wall'], feeIds: [], previous }).plan.itemRatios).toEqual([{ itemId: 'wall', ratio: 1 }])
    expect(carryPayrollARatioPlan({ periodKind: 'retention', itemIds: ['wall'], feeIds: [], current }).reasons).toContain('尾款的分项与费用比例固定为 100%')
  })

  it('人工移除费用单独比例后使用整单默认，不复活上月覆盖', () => {
    const previous = { schemaVersion: 1 as const, itemRatios: [], feeRatios: [{ kind: 'fee' as const, id: 'housing', ratio: 0.9 }] }
    const current = { schemaVersion: 1 as const, itemRatios: [], feeRatios: [] }
    expect(carryPayrollARatioPlan({ periodKind: 'monthly', itemIds: [], feeIds: [{ kind: 'fee', id: 'housing' }], previous, current }).plan.feeRatios).toEqual([])
  })

  it('同一工程量分项先合计再分别计比例，费用采用默认或单独比例', () => {
    const result = calculatePayrollAItemRatios({
      periodKind: 'monthly',
      defaultRatio: 0.8,
      itemRatios: [{ itemId: 'wall', ratio: 0.5 }, { itemId: 'floor', ratio: 0.2 }],
      feeRatios: [{ kind: 'negative', id: 'negative-1', ratio: 0.5 }],
      workLines: [work('wall', 100), work('wall', 0.01), work('floor', 100)],
      feeLines: [fee('housing', 50)],
      negativeLines: [negative('negative-1', -1000)],
    })
    expect(result.itemAmounts.map(row => [row.itemId, row.amount.value])).toEqual([['wall', 50.01], ['floor', 20]])
    expect(result.feeAmounts.map(row => [row.id, row.amount.value])).toEqual([['housing', 40], ['negative-1', -5]])
    expect(result.cumulativeAmount).toMatchObject({ state: 'known', value: 105.01 })
    expect(result.reasons).toEqual([])
  })

  it('新增分项未填写比例保持未知，已知零比例不能被默认值覆盖', () => {
    const result = calculatePayrollAItemRatios({ periodKind: 'monthly', defaultRatio: 0.8, itemRatios: [{ itemId: 'wall', ratio: 0 }], feeRatios: [{ kind: 'fee', id: 'housing', ratio: 0 }], workLines: [work('wall', 100), work('new-item', 30)], feeLines: [fee('housing', 50)], negativeLines: [] })
    expect(result.itemAmounts[0]?.amount.value).toBe(0)
    expect(result.feeAmounts[0]?.amount.value).toBe(0)
    expect(result.cumulativeAmount).toMatchObject({ value: null, state: 'partial', knownValue: 0 })
    expect(result.reasons).toContain('工程量分项 new-item 尚未填写比例')
  })

  it('尾款逐项固定 100%，不允许传入其他显式比例', () => {
    const base = { periodKind: 'retention' as const, defaultRatio: 1, itemRatios: [], feeRatios: [], workLines: [work('wall', 100)], feeLines: [fee('housing', 20)], negativeLines: [] }
    expect(calculatePayrollAItemRatios(base).cumulativeAmount.value).toBe(120)
    const invalid = calculatePayrollAItemRatios({ ...base, itemRatios: [{ itemId: 'wall', ratio: 0.9 }] })
    expect(invalid.cumulativeAmount.value).toBeNull()
    expect(invalid.reasons).toContain('工资分项比例身份重复或比例无效')
  })

  it('比例重复、费用默认比例缺失或原金额未知不能被当成零', () => {
    const result = calculatePayrollAItemRatios({ periodKind: 'monthly', defaultRatio: null, itemRatios: [{ itemId: 'wall', ratio: 0.7 }, { itemId: 'wall', ratio: 0.8 }], feeRatios: [], workLines: [work('wall', null)], feeLines: [fee('housing', 50)], negativeLines: [] })
    expect(result.cumulativeAmount.value).toBeNull()
    expect(result.reasons).toContain('工资分项比例身份重复或比例无效')
    expect(result.reasons).toContain('费用 housing 尚未填写默认比例或单独比例')
    expect(result.reasons).toContain('工程量分项 wall 的金额或比例未完整提供')
  })

  it('同一分项存在未知金额时保留有证据的小计，不计算完整累计', () => {
    const result = calculatePayrollAItemRatios({ periodKind: 'monthly', defaultRatio: 0.8, itemRatios: [{ itemId: 'wall', ratio: 0.5 }], feeRatios: [], workLines: [work('wall', 100), work('wall', null)], feeLines: [], negativeLines: [] })
    expect(result.itemAmounts[0]?.amount).toMatchObject({ value: null, knownValue: 50, state: 'partial' })
    expect(result.cumulativeAmount).toMatchObject({ value: null, knownValue: 50, state: 'partial' })
  })

  it('异常金额不能用于核算或伪装为已知零', () => {
    const result = calculatePayrollAItemRatios({ periodKind: 'monthly', defaultRatio: 1, itemRatios: [{ itemId: 'wall', ratio: 1 }], feeRatios: [], workLines: [work('wall', Number.NaN)], feeLines: [], negativeLines: [] })
    expect(result.cumulativeAmount).toMatchObject({ value: null, knownValue: null, state: 'unknown' })
    expect(result.reasons).toContain('工程量分项 wall 的金额或比例未完整提供')
  })

  it('多个金额相加超过安全精度时拒绝生成累计数', () => {
    const result = calculatePayrollAItemRatios({ periodKind: 'monthly', defaultRatio: 1, itemRatios: [{ itemId: 'wall', ratio: 1 }, { itemId: 'floor', ratio: 1 }], feeRatios: [], workLines: [work('wall', 50_000_000_000_000), work('floor', 50_000_000_000_000)], feeLines: [], negativeLines: [] })
    expect(result.cumulativeAmount).toMatchObject({ value: null, knownValue: null, state: 'unknown' })
    expect(result.reasons).toContain('分项累计金额超出安全精度，不能核算')
  })
})
