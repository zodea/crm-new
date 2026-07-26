import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createBoqWorkbookExport, createMonthlyStatementExport } from '~/lib/boq/export'
import { loadMonthlyStatement } from '~/lib/boq/monthly'
import { loadBoqWorkspace } from '~/lib/boq/read-model'
import { runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await seedIfEmpty(db)
})

afterEach(() => db.close())

describe('boq exports', () => {
  it('creates one direct-save workbook with boq, change and monthly ledgers', async () => {
    const workspace = await loadBoqWorkspace(db, 'proj_demo_001', 'con_demo_sg01')
    const output = createBoqWorkbookExport(workspace!, new Date(2026, 6, 25))
    expect(output.defaultName).toBe('合和新城_合和新城施工总承包合同_BOQ台账_2026-07-25.xlsx')

    const workbook = XLSX.read(output.data, { type: 'array' })
    expect(workbook.SheetNames).toEqual(['合同清单', '变更单', '月度报量'])
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['合同清单']!)
    expect(rows).toContainEqual(expect.objectContaining({
      分部: '装饰装修',
      工种: '泥水工',
      分项名称: '墙砖铺贴',
      合同工程量: 28,
      合同单价: 260,
      合价: 7280,
      来源: '合和新城施工合同清单.xlsx·户内装修·31',
    }))
  })

  it('exports a monthly statement with automatic and adjusted quantity side by side', async () => {
    const statement = await loadMonthlyStatement(db, 'monthly_statement_demo_001')
    const output = createMonthlyStatementExport(
      statement!,
      '合和新城',
      '合和新城施工总承包合同',
    )
    const workbook = XLSX.read(output.data, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['2026-06月度报量']!)
    expect(rows).toEqual([expect.objectContaining({
      分项名称: '地砖铺贴',
      自动量: 60,
      手调量: 62,
      本期报量: 62,
      合同单价: 80,
      合价: 4960,
    })])
  })
})
