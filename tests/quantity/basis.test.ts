import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertQuantityBasis,
  isQuantityBasis,
  QUANTITY_BASIS_COLUMNS,
  QUANTITY_BASIS_OPTIONS,
  quantityBasisLabel,
} from '~/lib/quantity/basis'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
})

afterEach(() => db.close())

describe('工程量取数基准', () => {
  it.each((Object.values(QUANTITY_BASIS_COLUMNS)).map(input => ({ input })))('列名映射指向 house_type_template_items 上真实存在的三量列：输入案例 %#', async ({ input: column }) => {
    const columns = await db.select<{ name: string }>(
      `SELECT name FROM pragma_table_info('house_type_template_items')`,
    )
    const existing = new Set(columns.map(column => column.name))
    expect(existing).toContain(column)
  })

  it('三个基准各自映射到不同的列，不会共用同一口径', () => {
    const mapped = Object.values(QUANTITY_BASIS_COLUMNS)
    expect(new Set(mapped).size).toBe(mapped.length)
  })

  it('选项与显示名使用约定的三个基准', () => {
    expect(QUANTITY_BASIS_OPTIONS).toEqual([
      { value: 'contract', label: '合同量' },
      { value: 'provisional', label: '暂估量' },
      { value: 'field', label: '现场复核量' },
    ])
    expect(quantityBasisLabel('contract')).toBe('合同量')
    expect(quantityBasisLabel('provisional')).toBe('暂估量')
    expect(quantityBasisLabel('field')).toBe('现场复核量')
  })

  it('拒绝未知基准，避免把任意字符串拼进 SQL 列名', () => {
    expect(() => assertQuantityBasis('contract_qty')).toThrow('取数基准')
  })

  it.each([
    { case: '\'field\'', input: 'field', expected: true },
    { case: '\'recognized_contract_qty\'', input: 'recognized_contract_qty', expected: false },
    { case: '\'\'', input: '', expected: false },
  ])('拒绝未知基准，避免把任意字符串拼进 SQL 列名 / isQuantityBasis：$case', ({ input, expected }) => {
    expect(isQuantityBasis(input)).toBe(expected)
  })
})
