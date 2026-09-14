import type { PayrollC2Command, PayrollC2FormRead } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollDayworkCommand } from '../../app/lib/payroll/central-daywork-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { saveSignedDayworkRecord, upsertC2SubjectConfig } from '../../app/lib/payroll/daywork'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollC2MigrationReferences, payrollC2ReceiptReferences } from '../../server/utils/payroll-c2-migration-references'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { importPayrollC2MigrationSource, seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

it('另一项目真实 C2 核对来源保留时，可单独准备恢复未被引用的原项目', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollC2MigrationSource(db)
    await db.execute('INSERT INTO projects(id,name) VALUES (\'unrelated-project\',\'另一个工程\')')
    await db.execute('INSERT INTO crews(id,name) VALUES (\'unrelated-crew\',\'另一班组\')')
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (\'unrelated-worker\',\'另一负责人\',\'unrelated-crew\',\'unrelated-project\')')
    await upsertC2SubjectConfig(db, { projectId: 'unrelated-project', crewId: 'unrelated-crew', leaderWorkerId: 'unrelated-worker', unitRate: 350, ruleText: '' })
    await saveSignedDayworkRecord(db, { projectId: 'unrelated-project', crewId: 'unrelated-crew', workerId: 'unrelated-worker', workDate: '2026-08-01', workContent: '另一项目零星签工', startTime: '08:00', endTime: '12:00', laborUnits: 0.5, witness: '证明人', confirmedOn: '2026-08-02', status: 'confirmed' })
    const { batch } = await importPayrollC2MigrationSource(db)
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'unrelated-project')!.serverId
    const leaderWorkerId = batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'unrelated-worker')!.serverId
    const config = await payrollService.c2Config({ origin: 'real' }, { projectId, leaderWorkerId })
    const draft = { projectId, leaderWorkerId, crewId: config.config!.crewId, memberWorkerIds: [leaderWorkerId], month: '2026-08', note: '' }
    const read = await payrollService.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'unrelated-c2', draft })
    const command: PayrollC2Command = { commandId: 'unrelated-save', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, statementId: null, draftKey: read.draftKey, configScope: null, configId: null, action: { kind: 'save-c2-draft', draft } }
    const saved = await payrollService.executeC2(command)
    const check = await payrollService.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    await payrollService.executeC2({ ...command, commandId: 'unrelated-check', sourceVersion: check.context.sourceVersion, statementId: saved.statementId, draftKey: null, action: { kind: 'check-c2' } })
    const authority = coreMigrationTestInstance.snapshot(session)
    const before = await readAll()
    const candidate = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(entity => !(entity.entityType === 'payroll_projects' && entity.legacyId === 'c2-project')) })
    await candidate.abort()
    expect(await readAll()).toEqual(before)
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
    expect((await payrollService.c2Form({ origin: 'real' }, { statementId: saved.statementId! })).storedSource?.subject.projectId).toBe(projectId)
  }
  finally { db.close() }
})

it('真实 C2 配置回执保护实际配置 ID，零/NULL 原文不被恢复补写', async () => {
  const { projectId, leaderWorkerId } = await importedSource()
  const read = await payrollService.c2Config({ origin: 'real' }, { projectId, leaderWorkerId })
  const id = read.config!.id
  const original = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<Record<string, unknown>>('SELECT * FROM payroll_subject_configs WHERE id=?', [id]))[0]!)
  const command: PayrollC2Command = { commandId: 'b-config-receipt', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, statementId: null, draftKey: null, configScope: read.scope, configId: id, action: { kind: 'save-c2-config', config: { crewId: read.config!.crewId, unitRate: 380.125, ruleText: '' } } }
  const saved = await payrollService.executeC2(command)
  expect(saved).toMatchObject({ configId: id, dayworkRecordIds: [], dayworkLinkIds: [] })
  await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const [receipt] = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
    expect(payrollC2ReceiptReferences(receipt!)!.has(JSON.stringify(['payroll_subject_configs', id]))).toBe(true)
    const columns = Object.keys(original).filter(column => column !== 'id')
    await tx.execute(`UPDATE payroll_subject_configs SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=?`, [...columns.map(column => original[column]), id])
    for (const logId of saved.logIds)
      await tx.execute('DELETE FROM operation_logs WHERE id=?', [logId])
  })
  const authority = coreMigrationTestInstance.snapshot(session)
  const before = await readAll()
  await expect(quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(entity => entity.entityType !== 'payroll_projects') })).rejects.toMatchObject({ problem: { code: 'conflict' } })
  expect(await readAll()).toEqual(before)
})

it.each(['source-table', 'source-audit-before', 'source-audit-after', 'frozen-source', 'frozen-audit', 'frozen-document', 'frozen-links', 'checked-edit'] as const)('真实 C2 核对和实发后只余一种稳定来源仍挡恢复：%s', async (kind) => {
  const { projectId, leaderWorkerId, workerId } = await importedSource()
  const config = await payrollService.c2Config({ origin: 'real' }, { projectId, leaderWorkerId })
  const memberWorkerIds = config.options.workers.filter(row => row.eligible).map(row => row.id)
  const draft = { projectId, leaderWorkerId, crewId: config.config!.crewId, memberWorkerIds, month: '2026-08', note: '真实恢复来源测试' }
  function command(read: PayrollC2FormRead, commandId: string, action: PayrollC2Command['action']): PayrollC2Command {
    return { commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, statementId: read.statementId, draftKey: read.draftKey, configScope: null, configId: null, action }
  }
  const form = await payrollService.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'b-source', draft })
  const saved = await payrollService.executeC2(command(form, 'b-c2-save', { kind: 'save-c2-draft', draft }))
  await payrollService.executeC2(command(await payrollService.c2Form({ origin: 'real' }, { statementId: saved.statementId! }), 'b-c2-check', { kind: 'check-c2' }))
  const checked = await payrollService.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
  const recordId = checked.storedSource!.facts[0]!.id
  const configId = checked.storedSource!.config.id
  if (kind === 'checked-edit') {
    const read = await payrollService.dayworkForm({ origin: 'real' }, { recordId })
    const record = read.record!
    expect(record.occupations).toContainEqual(expect.objectContaining({ statementId: saved.statementId, kind: 'active-link', status: 'checked' }))
    expect(read.eligibility.canEdit).toBe(true)
    await payrollService.executeDaywork({ commandId: 'b-checked-daywork-edit', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, recordId, draftKey: null, originalScope: { projectId, crewId: record.crewId, workerId: record.workerId, workDate: record.workDate }, action: { kind: 'save-daywork', record: { projectId, crewId: record.crewId, workerId: record.workerId, workDate: record.workDate, workContent: record.workContent!, startTime: record.startTime!, endTime: record.endTime!, laborUnits: record.laborUnits, witness: record.witness!, confirmedOn: record.confirmedOn, status: 'confirmed', note: '领用后合法修正原签工' } } })
    expect((await payrollService.c2Form({ origin: 'real' }, { statementId: saved.statementId! })).needsRecheck).toBe(true)
  }
  if (kind.startsWith('frozen')) {
    await payrollService.executeC2(command(checked, 'b-c2-release', { kind: 'release-c2', release: { actualAmount: 100, allocations: memberWorkerIds.map(id => ({ workerId: id, amount: id === workerId ? 100 : 0 })) } }))
    expect((await payrollService.c2Output({ origin: 'real' }, saved.statementId!)).state).toBe('available')
  }
  await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const [source] = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_c2_statement_sources WHERE statement_id=?', [saved.statementId])
    const [head] = await tx.select<Record<string, unknown>>('SELECT * FROM wage_statements WHERE id=?', [saved.statementId])
    const receipts = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE action IN (\'save-c2-draft\',\'check-c2\',\'release-c2\')')
    for (const receipt of receipts) {
      const references = payrollC2ReceiptReferences(receipt)!
      expect(references.has(JSON.stringify(['signed_daywork_records', recordId]))).toBe(true)
      expect(references.has(JSON.stringify(['payroll_subject_configs', configId]))).toBe(true)
      expect([...references].some(reference => JSON.parse(reference)[0] === 'wage_statement_daywork_records')).toBe(true)
    }
    // 隔离“唯一剩余证据”反例；不把删减后的测试库称为正常业务状态。
    await tx.execute('DELETE FROM payroll_command_receipts')
    await tx.execute('DELETE FROM wage_statement_daywork_records WHERE statement_id=?', [saved.statementId])
    await tx.execute('DELETE FROM operation_logs WHERE table_name IN (\'payroll_c2_statement_sources\',\'wage_statements\',\'wage_statement_daywork_records\')')
    await tx.execute('UPDATE wage_statements SET subject_config_id=NULL,snapshot_json=NULL WHERE id=?', [saved.statementId])
    if (kind !== 'source-table' && kind !== 'checked-edit')
      await tx.execute('DELETE FROM payroll_c2_statement_sources WHERE statement_id=?', [saved.statementId])
    if (kind === 'source-audit-before' || kind === 'source-audit-after')
      await tx.execute(`INSERT INTO operation_logs(id,table_name,record_id,action,${kind === 'source-audit-before' ? 'before_data' : 'after_data'}) VALUES (\'source-only-log\',\'payroll_c2_statement_sources\',?,\'update\',?)`, [saved.statementId, JSON.stringify(source)])
    const snapshot = JSON.parse(String(head!.snapshot_json))
    if (kind === 'frozen-source')
      await tx.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify({ c2Source: snapshot.c2Source }), saved.statementId])
    if (kind === 'frozen-audit')
      await tx.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'frozen-only-log\',\'wage_statements\',?,\'update\',?)', [saved.statementId, JSON.stringify({ snapshot_json: JSON.stringify({ c2Source: snapshot.c2Source }) })])
    if (kind === 'frozen-document')
      await tx.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify({ c2Document: snapshot.c2Document }), saved.statementId])
    if (kind === 'frozen-links')
      await tx.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify({ formatFamily: 'C2', dayworkLinks: snapshot.dayworkLinks }), saved.statementId])
    const references = await payrollC2MigrationReferences(tx)
    expect(references.has(JSON.stringify(['signed_daywork_records', recordId]))).toBe(true)
    expect(references.has(JSON.stringify(['payroll_subject_configs', configId]))).toBe(kind !== 'frozen-links')
    if (kind === 'frozen-links')
      expect(references.has(JSON.stringify(['wage_statement_daywork_records', snapshot.dayworkLinks[0].id]))).toBe(true)
  })
  const authority = coreMigrationTestInstance.snapshot(session)
  const before = await readAll()
  await expect(quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(entity => entity.entityType !== 'payroll_projects') })).rejects.toMatchObject({ problem: { code: 'conflict' } })
  expect(await readAll()).toEqual(before)
})

it.each(['same-worker', 'unrelated-worker'] as const)('同库候选与日常独立签工共用互斥，真实零考勤不扩到无关人：%s', async (kind) => {
  const db = await createMemoryDb()
  try {
    await seedPayrollC2MigrationSource(db)
    const imported = await importPayrollC2MigrationSource(db)
    const list = await payrollService.dayworkList({ origin: 'real' }, { projectId: imported.projectId, month: '2026-08', crewId: null, dayworkStatuses: [] })
    const worker = list.options.workers.find(row => row.id === imported.workerId)!
    const draft = { projectId: imported.projectId, crewId: worker.crewId, workerId: worker.id, workDate: '2026-08-04', workContent: '迁入之后的独立日常签工', startTime: '08:00', endTime: '12:00', laborUnits: 0.5, witness: '', confirmedOn: null, status: 'draft' as const, note: '' }
    const read = await payrollService.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: 'b-independent', draft })
    await payrollService.executeDaywork({ commandId: 'b-independent-save', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: imported.projectId, recordId: null, draftKey: read.draftKey, originalScope: null, action: { kind: 'save-daywork', record: draft } })
    await db.execute('INSERT INTO attendance_records(id,project_id,worker_id,work_date,hours,overtime_hours) VALUES (\'candidate-zero\',\'c2-project\',?,\'2026-08-03\',0,0)', [kind === 'same-worker' ? 'c2-worker' : 'c2-zero'])
    const incoming = await readQuantityCoreSource(db)
    const raw = incoming.entities.payroll_projects![0]!.attributes!.payrollGraphJson!
    const authority = coreMigrationTestInstance.snapshot(session)
    const candidate = { ...authority, activeBatchId: 'b-next-sqlite-candidate', entities: authority.entities.map(entity => ({ ...entity, batchId: 'b-next-sqlite-candidate', attributes: entity.entityType === 'payroll_projects' ? { ...entity.attributes, payrollGraphJson: raw } : entity.attributes })) }
    const before = await readAll()
    let rejection: unknown
    try {
      const prepared = await quantityTestInstance.prepareMigrationSnapshot(candidate)
      await prepared.abort()
    }
    catch (cause) { rejection = cause }
    if (kind === 'same-worker')
      expect(rejection).toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('迁入来源与当前独立') } })
    else
      expect(rejection).toBeUndefined()
    expect(await readAll()).toEqual(before)
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
  }
  finally { db.close() }
})
async function importedSource() {
  const db = await createMemoryDb()
  try {
    await seedPayrollC2MigrationSource(db)
    return await importPayrollC2MigrationSource(db)
  }
  finally { db.close() }
}
function readAll() {
  return quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
    return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
  })
}

it.each(['receipt-only', 'sql-null-body', 'invalid-body', 'unknown-field', 'wrong-result', 'unknown-action'] as const)('真实签工命令只余回执的恢复边界：%s', async (kind) => {
  const { projectId } = await importedSource()
  const list = await payrollService.dayworkList({ origin: 'real' }, { projectId, month: '2026-08', crewId: null, dayworkStatuses: [] })
  const record = list.records.find(row => row.status === 'draft')!
  const read = await payrollService.dayworkForm({ origin: 'real' }, { recordId: record.id })
  const original = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<Record<string, unknown>>('SELECT * FROM signed_daywork_records WHERE id=?', [record.id]))[0]!)
  const command: PayrollDayworkCommand = { commandId: 'b-original-daywork', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, recordId: record.id, draftKey: null, originalScope: { projectId, crewId: record.crewId, workerId: record.workerId, workDate: record.workDate }, action: { kind: 'save-daywork', record: { projectId, crewId: record.crewId, workerId: record.workerId, workDate: record.workDate, workContent: record.workContent!, startTime: record.startTime!, endTime: record.endTime!, laborUnits: 0.5, witness: '', confirmedOn: null, status: 'draft', note: '真实保存后只留回执' } } }
  const result = await payrollService.executeDaywork(command)
  expect(result.recordId).toBe(record.id)
  await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const [receipt] = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
    expect(payrollC2ReceiptReferences(receipt!)!.has(JSON.stringify(['signed_daywork_records', record.id]))).toBe(true)
    const columns = Object.keys(original).filter(column => column !== 'id')
    await tx.execute(`UPDATE signed_daywork_records SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=?`, [...columns.map(column => original[column]), record.id])
    await tx.execute('DELETE FROM operation_logs WHERE table_name=\'signed_daywork_records\' AND id IN (SELECT value FROM json_each(?))', [JSON.stringify(result.logIds)])
    if (kind === 'sql-null-body')
      await tx.execute('UPDATE payroll_command_receipts SET command_json=NULL WHERE command_id=?', [command.commandId])
    if (kind === 'invalid-body')
      await tx.execute('UPDATE payroll_command_receipts SET command_json=\'{\' WHERE command_id=?', [command.commandId])
    if (kind === 'wrong-result')
      await tx.execute('UPDATE payroll_command_receipts SET result_json=? WHERE command_id=?', [JSON.stringify({ ...result, recordId: 'unrelated-record' }), command.commandId])
    if (kind === 'unknown-action')
      await tx.execute('UPDATE payroll_command_receipts SET action=\'unknown-action\' WHERE command_id=?', [command.commandId])
    if (kind === 'unknown-field') {
      const body = payrollCanonical({ ...command, guessedReferences: [record.id] })
      await tx.execute('UPDATE payroll_command_receipts SET command_json=?,fingerprint=? WHERE command_id=?', [body, createHash('sha256').update(body).digest('hex'), command.commandId])
    }
  })
  const authority = coreMigrationTestInstance.snapshot(session)
  const before = await readAll()
  const repeated = await quantityTestInstance.prepareMigrationSnapshot(authority)
  repeated.commit()
  expect(await readAll()).toEqual(before)
  let rejection: unknown
  try {
    const candidate = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(row => row.entityType !== 'payroll_projects') })
    await candidate.abort()
  }
  catch (cause) { rejection = cause }
  if (kind === 'sql-null-body')
    expect(rejection).toBeUndefined()
  else
    expect(rejection).toMatchObject({ problem: { code: 'conflict' } })
  expect(await readAll()).toEqual(before)
  expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
})
