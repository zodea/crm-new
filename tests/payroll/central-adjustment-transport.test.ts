import { afterEach, expect, it } from 'vitest'
import { PAYROLL_CENTRAL_MIGRATION_TABLES } from '~/lib/migration/payroll-central-source'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAdjustmentMigrationFixture } from '../helpers/payroll-adjustment-migration-fixture'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

it('真实 P4 SQLite 原图迁入完整中央工资表与回执审计，正文逐字保留且重复接管不覆盖', async () => {
  const f = await createPayrollAdjustmentMigrationFixture()
  const sourceGraph = JSON.parse(f.evidence.source_graph_json)
  expect(sourceGraph.schemaVersion).toBe(2)
  expect(Object.keys(sourceGraph.central.tables).sort()).toEqual([...PAYROLL_CENTRAL_MIGRATION_TABLES].sort())
  const readAll = () => f.instance.withWorkspaceTransaction(async tx => Object.fromEntries(await Promise.all(PAYROLL_CENTRAL_MIGRATION_TABLES.map(async table => [table, await tx.select(`SELECT * FROM ${table} ORDER BY rowid`)]))))
  const before = await readAll()
  expect(before.payroll_adjustments).toMatchObject([{ id: f.adjustmentId, original_statement_id: f.statementId, confirmed_snapshot_json: sourceGraph.central.tables.payroll_adjustments[0].confirmed_snapshot_json }])
  expect(before.payroll_actual_events).toMatchObject([{ id: f.eventId, signed_amount_fen: -4000, confirmed_snapshot_json: sourceGraph.central.tables.payroll_actual_events[0].confirmed_snapshot_json }])
  expect(before.payroll_adjustment_applications).toHaveLength(1)
  expect(before.payroll_command_receipts).toHaveLength(sourceGraph.central.tables.payroll_command_receipts.length)
  const receiptOriginals = sourceGraph.central.tables.payroll_command_receipts.map((row: { command_json: string }) => row.command_json).sort()
  expect((before.payroll_command_receipts as Array<{ command_json: string }>).map(row => row.command_json).sort()).toEqual(receiptOriginals)
  const repeated = await quantityTestInstance.prepareMigrationSnapshot(coreMigrationTestInstance.snapshot(f.session))
  repeated.commit()
  expect(await readAll()).toEqual(before)
})

it.each(['unchanged', 'changed-payment', 'deleted-application'] as const)('p4 完整迁入后的受控恢复逐行保全原图：%s', async (kind) => {
  const f = await createPayrollAdjustmentMigrationFixture()
  if (kind === 'changed-payment')
    await f.instance.withWorkspaceTransaction(tx => tx.execute('UPDATE payroll_actual_events SET signed_amount_fen=-5000 WHERE id=?', [f.eventId]))
  if (kind === 'deleted-application')
    await f.instance.withWorkspaceTransaction(tx => tx.execute('DELETE FROM payroll_adjustment_applications WHERE adjustment_id=?', [f.adjustmentId]))
  const authority = coreMigrationTestInstance.snapshot(f.session)
  const readAll = () => f.instance.withWorkspaceTransaction(async tx => Object.fromEntries(await Promise.all(PAYROLL_CENTRAL_MIGRATION_TABLES.map(async table => [table, await tx.select(`SELECT * FROM ${table} ORDER BY rowid`)]))))
  const before = await readAll()
  const rollback = () => coreMigrationTestInstance.rollback({ ...f.envelope('p4-source-rollback'), batchId: f.batch.batchId }, f.session)
  if (kind === 'unchanged') {
    await rollback()
    expect(coreMigrationTestInstance.snapshot(f.session).authority).toBe('local')
    expect(await f.instance.withWorkspaceTransaction(tx => tx.select('SELECT * FROM payroll_actual_events'))).toEqual([])
  }
  else {
    await expect(rollback()).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(f.session)).toEqual(authority)
    expect(await readAll()).toEqual(before)
  }
})

it('保留完整 P4 原图时仍可恢复另一无引用的工资项目，原身份回执不与中央映射互相误判', async () => {
  const f = await createPayrollAdjustmentMigrationFixture({ unrelatedProject: true })
  const authority = coreMigrationTestInstance.snapshot(f.session)
  const next = await f.instance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(e => !(e.entityType === 'payroll_projects' && e.legacyId === 'other-project')) })
  await next.abort()
  expect(coreMigrationTestInstance.snapshot(f.session)).toEqual(authority)
})
