import type { CoreMigrationSourceDTO } from '../../app/lib/migration/core-contract'
import type { PayrollAttendanceCommand } from '../../app/lib/payroll/central-attendance-contract'
import type { PayrollC1Command, PayrollC1FormRead } from '../../app/lib/payroll/central-c1-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { payrollAttendanceCanonical } from '../../app/lib/payroll/central-attendance-codec'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { seedPayrollC1Source } from '../helpers/payroll-c1-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

async function importedSource() {
  const db = await createMemoryDb()
  try {
    const source: CoreMigrationSourceDTO = await seedPayrollC1Source(db)
    const bytes = db.raw.export()
    const hash = createHash('sha256').update(bytes).digest('hex')
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('c1-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('c1-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: bytes.length, createdAt: new Date().toISOString(), immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('c1-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('c1-confirm'), batchId: batch.batchId }, session)
    return { batch, projectId: batch.mappings.find(row => row.entityType === 'projects')!.serverId, workerId: batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'c1-worker')!.serverId }
  }
  finally { db.close() }
}

function readAll() {
  return quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
    return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
  })
}

it.each(['related-rate', 'unrelated-rate'] as const)('恢复在删除前保护实际 C1 费率引用，不误阻无关人员配置：%s', async (kind) => {
  const { batch, workerId } = await importedSource()
  await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    await tx.execute('INSERT INTO projects(id,name) VALUES (\'c1-independent-project\',\'独立配置项目\')')
    await tx.execute('INSERT INTO workers(id,name) VALUES (\'c1-independent-worker\',\'独立配置工人\')')
    await tx.execute('INSERT INTO payroll_c1_rate_revisions(id,project_id,worker_id,effective_month,daily_wage,overtime_rate,revision,operator_id,created_at) VALUES (\'c1-independent-rate\',\'c1-independent-project\',?,\'2026-08\',481,0,1,\'actor-default\',\'2026-09-14\')', [kind === 'related-rate' ? workerId : 'c1-independent-worker'])
  })
  const before = await readAll()
  const authority = coreMigrationTestInstance.snapshot(session)
  const repeat = await quantityTestInstance.prepareMigrationSnapshot(authority)
  repeat.commit()
  expect(await readAll()).toEqual(before)
  const rollback = coreMigrationTestInstance.rollback({ ...envelope('c1-rollback'), batchId: batch.batchId }, session)
  if (kind === 'related-rate') {
    await expect(rollback).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await readAll()).toEqual(before)
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
  }
  else {
    await expect(rollback).resolves.toBeDefined()
    expect((await readAll()).payroll_c1_rate_revisions).toEqual(before.payroll_c1_rate_revisions)
  }
})

it('迟到的迁入考勤不能越过同库独立待确认签工占用，失败前后整批不变', async () => {
  const { projectId, workerId } = await importedSource()
  const authority = coreMigrationTestInstance.snapshot(session)
  const withoutPayroll = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(row => row.entityType !== 'payroll_projects') })
  withoutPayroll.commit()
  await quantityTestInstance.withWorkspaceTransaction(tx => tx.execute('INSERT INTO signed_daywork_records(id,project_id,worker_id,work_date,labor_units,status) VALUES (\'c1-pending-daywork\',?,?,\'2026-08-20\',0.5,\'draft\')', [projectId, workerId]))
  const before = await readAll()
  let rejection: unknown
  try {
    const candidate = await quantityTestInstance.prepareMigrationSnapshot(authority)
    await candidate.abort()
  }
  catch (cause) { rejection = cause }
  expect(rejection).toMatchObject({ problem: { code: 'conflict' } })
  expect(await readAll()).toEqual(before)
  expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
})

it.each(['receipt-only', 'missing-body', 'invalid-body', 'foreign-result', 'unknown-body-field'] as const)('真实考勤命令回执保护原记录 ID，缺/坏证据不补造：%s', async (kind) => {
  const { projectId } = await importedSource()
  const read = await payrollService.attendanceMatrix({ origin: 'real' }, { projectId, month: '2026-08', crewId: null })
  const record = read.records.find(row => row.hours === 0)!
  const original = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<Record<string, unknown>>('SELECT * FROM attendance_records WHERE id=?', [record.id]))[0]!)
  const command: PayrollAttendanceCommand = { commandId: 'c1-attendance-save', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, scope: read.scope, action: { kind: 'upsert-attendance', record: { workerId: record.workerId, crewId: record.crewId, workDate: record.workDate, hours: 0, overtimeHours: 0, workContent: '', note: '' } } }
  const result = await payrollService.executeAttendance(command)
  expect(result.recordId).toBe(record.id)
  await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const [receipt] = await tx.select<{ command_json: string, statement_id: null, config_scope_json: null }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
    expect(JSON.parse(receipt!.command_json)).toEqual(command)
    expect(receipt).toMatchObject({ statement_id: null, config_scope_json: null })
    // 隔离测试库复现仅回执存活的历史；正式接口没有绕过审计/恢复原件的写动作。
    const columns = Object.keys(original).filter(column => column !== 'id')
    await tx.execute(`UPDATE attendance_records SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=?`, [...columns.map(column => original[column]), record.id])
    await tx.execute('DELETE FROM operation_logs WHERE table_name=\'attendance_records\'')
    if (kind === 'missing-body')
      await tx.execute('UPDATE payroll_command_receipts SET command_json=NULL WHERE command_id=?', [command.commandId])
    if (kind === 'invalid-body')
      await tx.execute('UPDATE payroll_command_receipts SET command_json=\'{\' WHERE command_id=?', [command.commandId])
    if (kind === 'foreign-result')
      await tx.execute('UPDATE payroll_command_receipts SET result_json=? WHERE command_id=?', [JSON.stringify({ ...result, workerId: 'another-worker' }), command.commandId])
    if (kind === 'unknown-body-field') {
      const body = payrollAttendanceCanonical({ ...command, newUnprovedReferences: [record.id] })
      await tx.execute('UPDATE payroll_command_receipts SET command_json=?,fingerprint=? WHERE command_id=?', [body, createHash('sha256').update(body).digest('hex'), command.commandId])
    }
  })
  const authority = coreMigrationTestInstance.snapshot(session)
  const before = await readAll()
  const repeat = await quantityTestInstance.prepareMigrationSnapshot(authority)
  repeat.commit()
  expect(await readAll()).toEqual(before)
  let rejection: unknown
  try {
    const candidate = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(row => row.entityType !== 'payroll_projects') })
    await candidate.abort()
  }
  catch (cause) { rejection = cause }
  if (kind === 'missing-body')
    expect(rejection).toBeUndefined()
  else
    expect(rejection).toMatchObject({ problem: { code: 'conflict' } })
  expect(await readAll()).toEqual(before)
  expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
})

it.each(['source', 'frozen-source', 'frozen-audit'] as const)('真实 C1 配置/核对/实发完整零成员与逐行来源阻止撤回旧考勤：%s', async (kind) => {
  const { projectId } = await importedSource()
  let matrix = await payrollService.attendanceMatrix({ origin: 'real' }, { projectId, month: '2026-08', crewId: null })
  const leader = matrix.workers.find(row => row.name === '无原日薪')!
  const zero = matrix.workers.find(row => row.name === '明确零日薪')!
  const sourceZero = matrix.records.find(row => row.workerId === zero.id)!
  await payrollService.executeAttendance({ commandId: 'c1-new-attendance', workspaceId: matrix.context.workspaceId, actorId: matrix.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId: leader.id, crewId: leader.crewId, workDate: '2026-08-06', hours: 8, overtimeHours: 0, workContent: '真实工资考勤', note: '' } } })
  const config = await payrollService.c1Config({ origin: 'real' }, { projectId, month: '2026-08', crewId: leader.crewId })
  const configured = await payrollService.executeC1({ commandId: 'c1-rate-command', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId, statementId: null, draftKey: null, configScope: config.scope, action: { kind: 'save-c1-rates', rates: [{ workerId: leader.id, dailyWage: 480, overtimeRate: null }, { workerId: zero.id, dailyWage: null, overtimeRate: 0 }] } })
  expect(configured.rateRevisionIds).toHaveLength(2)
  const draft = { projectId, crewId: leader.crewId, leaderWorkerId: leader.id, memberWorkerIds: [leader.id, zero.id], month: '2026-08', note: '真实来源恢复验收' }
  function command(read: PayrollC1FormRead, commandId: string, action: PayrollC1Command['action']): PayrollC1Command {
    return { commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, statementId: read.statementId, draftKey: read.draftKey, configScope: null, action }
  }
  const preview = await payrollService.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'c1-source-draft', draft })
  expect(preview.totals.grossAmount.value).toBe(480)
  const saved = await payrollService.executeC1(command(preview, 'c1-save', { kind: 'save-c1-draft', draft }))
  const checkedRead = await payrollService.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
  await payrollService.executeC1(command(checkedRead, 'c1-check', { kind: 'check-c1' }))
  const releaseRead = await payrollService.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
  await payrollService.executeC1(command(releaseRead, 'c1-release', { kind: 'release-c1', release: { actualAmount: 480, allocations: [{ workerId: leader.id, amount: 480 }, { workerId: zero.id, amount: 0 }] } }))
  const output = await payrollService.c1Output({ origin: 'real' }, saved.statementId!)
  expect(output.state).toBe('available')
  expect(output.document?.allocations).toContainEqual(expect.objectContaining({ workerId: zero.id, allocatedAmountFen: 0 }))
  expect(output.document?.attendance).toContainEqual(expect.objectContaining({ id: sourceZero.id, hours: 0 }))
  matrix = await payrollService.attendanceMatrix({ origin: 'real' }, matrix.scope)
  expect(matrix.locks).toContainEqual(expect.objectContaining({ workerId: zero.id, statementId: saved.statementId, kind: 'released-month' }))
  if (kind !== 'source')
    await quantityTestInstance.withWorkspaceTransaction(tx => tx.execute('DELETE FROM payroll_c1_statement_sources WHERE statement_id=?', [saved.statementId]))
  if (kind === 'frozen-audit')
    await quantityTestInstance.withWorkspaceTransaction(tx => tx.execute('UPDATE wage_statements SET snapshot_json=NULL WHERE id=?', [saved.statementId]))
  const authority = coreMigrationTestInstance.snapshot(session)
  const before = await readAll()
  const repeat = await quantityTestInstance.prepareMigrationSnapshot(authority)
  repeat.commit()
  expect(await readAll()).toEqual(before)
  let rejection: unknown
  try {
    const candidate = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(row => row.entityType !== 'payroll_projects') })
    await candidate.abort()
  }
  catch (cause) { rejection = cause }
  expect(rejection).toMatchObject({ problem: { code: 'conflict' } })
  expect(await readAll()).toEqual(before)
  expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
})
