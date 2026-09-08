import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  filterTargetCostList,
  loadTargetCostList,
} from '~/lib/target-cost/list'
import { createMemoryDb } from '../helpers/memory-db'

describe('target cost list read model', () => {
  it('loads active versions with project and financial fields', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-a', '项目甲')`)
    await db.execute(`
      INSERT INTO target_costs (
        id, project_id, name, is_baseline, contract_revenue, planned_profit,
        signed_contract_sum, tax_inclusive_total, tax_exclusive_total, tax_amount,
        status, updated_at, deleted_at
      )
      VALUES
        ('target-a', 'project-a', '执行基线', 1, 1000, 200, 400, 800, 720, 80, 'submitted', '2026-07-30', NULL),
        ('target-draft', NULL, '未关联草稿', 0, 0, 0, 0, 0, 0, 0, 'draft', '2026-07-29', NULL),
        ('target-deleted', 'project-a', '已删除', 0, 1, 1, 1, 1, 1, 0, 'draft', '2026-07-31', '2026-07-31')
    `)

    const rows = await loadTargetCostList(db)

    expect(rows.map(row => row.id)).toEqual(['target-a', 'target-draft'])
    expect(rows[0]).toMatchObject({
      projectName: '项目甲',
      contractRevenue: 1000,
      plannedProfit: 200,
      signedContractSum: 400,
      taxInclusiveTotal: 800,
      taxExclusiveTotal: 720,
      taxAmount: 80,
      profitRate: 0.2,
      isBaseline: true,
    })
  })

  it('combines keyword, project, baseline and status filters', () => {
    const rows = [
      {
        id: 'a',
        projectId: 'project-a',
        projectName: '项目甲',
        name: '执行基线',
        isBaseline: true,
        contractRevenue: 100,
        plannedProfit: 10,
        taxInclusiveTotal: 80,
        taxExclusiveTotal: 70,
        taxAmount: 10,
        signedContractSum: 20,
        profitRate: 0.1,
        status: 'submitted',
        updatedAt: '',
      },
      {
        id: 'b',
        projectId: '',
        projectName: '',
        name: '未关联草稿',
        isBaseline: false,
        contractRevenue: 0,
        plannedProfit: 0,
        taxInclusiveTotal: 0,
        taxExclusiveTotal: 0,
        taxAmount: 0,
        signedContractSum: 0,
        profitRate: null,
        status: 'draft',
        updatedAt: '',
      },
    ]

    expect(filterTargetCostList(rows, {
      search: '项目甲',
      project: 'project-a',
      baseline: 'baseline',
      status: 'submitted',
    }).map(row => row.id)).toEqual(['a'])
    expect(filterTargetCostList(rows, {
      search: '',
      project: 'unassigned',
      baseline: 'history',
      status: 'draft',
    }).map(row => row.id)).toEqual(['b'])
    expect(filterTargetCostList(rows, {
      search: '',
      project: 'all',
      baseline: 'all',
      status: ['draft', 'submitted'],
    }).map(row => row.id)).toEqual(['a', 'b'])
    expect(filterTargetCostList(rows, {
      search: '',
      project: 'all',
      baseline: 'all',
      status: [],
    })).toHaveLength(2)
    expect(filterTargetCostList(rows, {
      search: '',
      project: 'all',
      baseline: ['baseline', 'history'],
      status: [],
    }).map(row => row.id)).toEqual(['a', 'b'])
    expect(filterTargetCostList(rows, {
      search: '',
      project: 'all',
      baseline: ['history'],
      status: ['draft', 'submitted'],
    }).map(row => row.id)).toEqual(['b'])
    expect(filterTargetCostList(rows, {
      search: '',
      project: 'all',
      baseline: ['baseline', 'history'],
      status: ['submitted'],
    }).map(row => row.id)).toEqual(['a'])
    expect(filterTargetCostList(rows, {
      search: '',
      project: 'all',
      baseline: [],
      status: [],
    })).toHaveLength(2)
  })
})
