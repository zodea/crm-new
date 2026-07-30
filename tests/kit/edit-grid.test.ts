import { describe, expect, it } from 'vitest'
import {
  aggregateRows,
  applyDerive,
  validateRows,
} from '~/lib/kit/edit-grid'

interface Line extends Record<string, unknown> {
  name: string
  qty: number | null
  unitPrice: number | null
  amount?: number
}

const columns = [
  { key: 'name', label: '名称', required: true },
  { key: 'qty', label: '数量', type: 'number' as const, required: true },
  { key: 'unitPrice', label: '单价', type: 'number' as const },
  {
    key: 'amount',
    label: '金额',
    type: 'readonly' as const,
    derive: (row: Readonly<Line>) => Number(row.qty || 0) * Number(row.unitPrice || 0),
  },
]

describe('kit edit grid 纯逻辑', () => {
  it('按列声明生成派生值且不修改调用方原行', () => {
    const source: Line[] = [{ name: '墙砖', qty: 2, unitPrice: 30 }]

    const result = applyDerive(source, columns)

    expect(result).toEqual([{ name: '墙砖', qty: 2, unitPrice: 30, amount: 60 }])
    expect(source[0]).not.toHaveProperty('amount')
  })

  it('返回必填错误的稳定行号和字段键，0 不是空值', () => {
    const rows: Line[] = [
      { name: ' ', qty: 0, unitPrice: 10 },
      { name: '地砖', qty: null, unitPrice: 20 },
    ]

    expect(validateRows(rows, columns)).toEqual([
      { row: 0, key: 'name' },
      { row: 1, key: 'qty' },
    ])
  })

  it('仅对有限数字求和，空值和非数字按 0 处理', () => {
    const rows = [
      { amount: 12.5 },
      { amount: '7.5' },
      { amount: '未记录' },
      { amount: null },
    ]

    expect(aggregateRows(rows, [{ key: 'amount', agg: 'sum' }])).toEqual({
      amount: 20,
    })
  })
})
