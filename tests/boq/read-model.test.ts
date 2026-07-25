import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { persistBoqLinePatch } from '~/lib/boq/lines'
import { loadBoqCatalog, loadBoqWorkspace } from '~/lib/boq/read-model'
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

describe('boq read model', () => {
  it('loads the canonical construction contract, source trace and approved effective values', async () => {
    const catalog = await loadBoqCatalog(db)
    const project = catalog.find(candidate => candidate.id === 'proj_demo_001')
    expect(project?.contracts).toContainEqual({
      id: 'con_demo_sg01',
      no: 'RJ-HHXC-SG-2025001',
      name: '合和新城施工总承包合同',
      lineCount: 10,
    })

    const workspace = await loadBoqWorkspace(db, 'proj_demo_001', 'con_demo_sg01')
    expect(workspace).toMatchObject({
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      projectName: '合和新城',
      contractName: '合和新城施工总承包合同',
    })
    expect(workspace.files).toContainEqual(expect.objectContaining({
      id: 'boq_file_demo_001',
      fileName: '合和新城施工合同清单.xlsx',
      parseStatus: 'parsed',
      lineCount: 10,
    }))

    const wall = workspace.lines.find(line => line.id === 'boq_line_demo_a_wall')
    expect(wall).toMatchObject({
      section: '装饰装修',
      trade: '泥水工',
      itemName: '墙砖铺贴',
      sourceSheet: '户内装修',
      sourceRow: 31,
      recognizedQty: 26,
      baseQty: 26,
      effectiveQty: 28,
      effectiveUnitPrice: 260,
      effectiveAmount: 7280,
      approvedChangeAmount: 520,
      manuallyCorrected: false,
    })
    expect(workspace.catalog.map(section => section.name)).toEqual(['防水工程', '机电安装', '装饰装修'])
    expect(workspace.summary.approvedChangeAmount).toBe(520)
    expect(workspace.summary.effectiveAmount).toBe(workspace.summary.baseAmount + 520)
    expect(workspace.changes).toContainEqual(expect.objectContaining({
      id: 'boq_change_demo_001',
      status: 'approved',
      ledgerId: 'boq_ledger_demo_001',
      attachmentCount: 0,
    }))
    expect(workspace.monthlyStatements).toContainEqual(expect.objectContaining({
      month: '2026-06',
      status: 'adjusted',
      totalAmount: 4960,
    }))
  })

  it('keeps recognized values immutable while marking manual corrections and logging the update', async () => {
    const logId = await persistBoqLinePatch(db, 'boq_line_demo_a_floor', {
      qty: 33,
      unitPrice: 82,
    })
    expect(logId).toEqual(expect.any(String))

    const workspace = await loadBoqWorkspace(db, 'proj_demo_001', 'con_demo_sg01')
    const floor = workspace.lines.find(line => line.id === 'boq_line_demo_a_floor')
    expect(floor).toMatchObject({
      recognizedQty: 31,
      recognizedUnitPrice: 80,
      baseQty: 33,
      baseUnitPrice: 82,
      baseAmount: 2706,
      manuallyCorrected: true,
    })
    const [log] = await db.select<{ action: string }>(
      'SELECT action FROM operation_logs WHERE id = ?',
      [logId],
    )
    expect(log?.action).toBe('update')
  })
})
