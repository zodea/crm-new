import type { ContractAuxRow } from '~/lib/contract/aux-list'
import { describe, expect, it } from 'vitest'
import {
  CONTRACT_AUX_LIST_CONFIG,
  contractAuxAmountTotal,
  contractAuxStatusTone,
  filterContractAuxRows,
} from '~/lib/contract/aux-list'

const rows: ContractAuxRow[] = [
  {
    id: 'company-1',
    no: 'GS-001',
    name: '办公室租赁',
    projectId: '',
    projectName: '',
    supplierId: '',
    supplierName: '',
    contractId: '',
    contractName: '',
    category: '房租',
    counterparty: '天河物业',
    period: '2026 年',
    amount: 100,
    date: '2026-01-01',
    status: '履约中',
  },
  {
    id: 'settlement-1',
    no: 'CGJS-001',
    name: '瓷砖六月结算',
    projectId: 'project-1',
    projectName: '合和新城',
    supplierId: 'supplier-1',
    supplierName: '大板东建材',
    contractId: 'contract-1',
    contractName: '合和新城瓷砖采购合同',
    category: '材料',
    counterparty: '',
    period: '2026-06',
    amount: 80,
    date: '2026-06-30',
    status: '待确认',
  },
]

describe('contract aux list configuration', () => {
  it('合计仅在适用行金额全部已知时成立，空集合和真实零保留零', () => {
    expect(contractAuxAmountTotal([])).toBe(0)
    expect(contractAuxAmountTotal([{ ...rows[0]!, amount: 0 }])).toBe(0)
    expect(contractAuxAmountTotal(rows)).toBe(180)
    expect(contractAuxAmountTotal([...rows, { ...rows[0]!, id: 'unknown', amount: null }])).toBeNull()
    expect(contractAuxAmountTotal([{ ...rows[0]!, amount: null }])).toBeNull()
  })
  describe('supports OR within each selection and AND across fields while preserving route context', () => {
    const filters = { search: '', project: [], category: ['房租', '材料'], status: ['履约中', '待确认'] }
    it.each([
      { case: '\'material_settlement\' / rows / filters', input: 'material_settlement', argument2: rows, argument3: filters, expected: rows },
      { case: '\'material_settlement\' / rows / { ...filters, status: [\'待确认\'] }', input: 'material_settlement', argument2: rows, argument3: { ...filters, status: ['待确认'] }, expected: [rows[1]] },
      { case: '\'material_settlement\' / rows / { ...filters, routeProject: \'project-1\' }', input: 'material_settlement', argument2: rows, argument3: { ...filters, routeProject: 'project-1' }, expected: [rows[1]] },
      { case: '\'material_settlement\' / rows / { ...filters, category: [] }', input: 'material_settlement', argument2: rows, argument3: { ...filters, category: [] }, expected: rows },
    ])('filterContractAuxRows：$case', ({ input, argument2, argument3, expected }) => {
      expect(filterContractAuxRows(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toEqual(expected)
    })
  })
  it('keeps company expenses project-free and preserves settlement relations', () => {
    const companyFields = CONTRACT_AUX_LIST_CONFIG.company_expense.columns.map(column => column.field)
    expect(companyFields).not.toContain('projectName')
    expect(companyFields).toEqual(expect.arrayContaining(['category', 'counterparty', 'period']))

    const settlementFields = CONTRACT_AUX_LIST_CONFIG.material_settlement.columns.map(column => column.field)
    expect(settlementFields).toEqual(expect.arrayContaining([
      'projectName',
      'supplierName',
      'contractName',
    ]))
  })

  it.each([
    { case: '\'company_expense\' / rows / { search: \'天河物业\', project: \'all\', category: \'房租\', status: \'履约中\', }', input: 'company_expense', argument2: rows, argument3: {
      search: '天河物业',
      project: 'all',
      category: '房租',
      status: '履约中',
    }, expected: [rows[0]] },
    { case: '\'material_settlement\' / rows / { search: \'采购合同\', project: \'project-1\', category: \'all\', status: \'待确认\', routeContract: \'contra', input: 'material_settlement', argument2: rows, argument3: {
      search: '采购合同',
      project: 'project-1',
      category: 'all',
      status: '待确认',
      routeContract: 'contract-1',
      routeSupplier: 'supplier-1',
    }, expected: [rows[1]] },
    { case: '\'material_settlement\' / rows / { search: \'\', project: \'all\', category: \'all\', status: \'all\', routeProject: \'another-project\',', input: 'material_settlement', argument2: rows, argument3: {
      search: '',
      project: 'all',
      category: 'all',
      status: 'all',
      routeProject: 'another-project',
    }, expected: [] },
  ])('filters by business fields and route context without flattening ids / filterContractAuxRows：$case', ({ input, argument2, argument3, expected }) => {
    expect(filterContractAuxRows(input, argument2, argument3)).toEqual(expected)
  })

  it.each([
    { case: '\'已确认\'', input: '已确认', expected: 'ok' },
    { case: '\'履约中\'', input: '履约中', expected: 'brand' },
    { case: '\'待确认\'', input: '待确认', expected: 'warn' },
    { case: '\'草稿\'', input: '草稿', expected: 'neutral' },
  ])('maps lifecycle states to stable semantic tones / contractAuxStatusTone：$case', ({ input, expected }) => {
    expect(contractAuxStatusTone(input)).toBe(expected)
  })
})
