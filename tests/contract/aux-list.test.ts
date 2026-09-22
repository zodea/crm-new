import type { ContractAuxRow } from '~/lib/contract/aux-list'
import { describe, expect, it } from 'vitest'
import {
  CONTRACT_AUX_LIST_CONFIG,
  contractAuxStatusClass,
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
  it('supports OR within each selection and AND across fields while preserving route context', () => {
    const filters = { search: '', project: [], category: ['房租', '材料'], status: ['履约中', '待确认'] }
    expect(filterContractAuxRows('material_settlement', rows, filters)).toEqual(rows)
    expect(filterContractAuxRows('material_settlement', rows, { ...filters, status: ['待确认'] })).toEqual([rows[1]])
    expect(filterContractAuxRows('material_settlement', rows, { ...filters, routeProject: 'project-1' })).toEqual([rows[1]])
    expect(filterContractAuxRows('material_settlement', rows, { ...filters, category: [] })).toEqual(rows)
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

  it('filters by business fields and route context without flattening ids', () => {
    expect(filterContractAuxRows('company_expense', rows, {
      search: '天河物业',
      project: 'all',
      category: '房租',
      status: '履约中',
    })).toEqual([rows[0]])

    expect(filterContractAuxRows('material_settlement', rows, {
      search: '采购合同',
      project: 'project-1',
      category: 'all',
      status: '待确认',
      routeContract: 'contract-1',
      routeSupplier: 'supplier-1',
    })).toEqual([rows[1]])

    expect(filterContractAuxRows('material_settlement', rows, {
      search: '',
      project: 'all',
      category: 'all',
      status: 'all',
      routeProject: 'another-project',
    })).toEqual([])
  })

  it('maps lifecycle states to stable semantic tones', () => {
    expect(contractAuxStatusClass('已确认')).toBe('chip-ok')
    expect(contractAuxStatusClass('履约中')).toBe('chip-brand')
    expect(contractAuxStatusClass('待确认')).toBe('chip-warn')
    expect(contractAuxStatusClass('草稿')).toContain('text-ink-faint')
  })
})
