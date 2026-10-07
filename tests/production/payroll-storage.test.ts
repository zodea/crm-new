import type { PayrollC1Action, PayrollC1CommandRead } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollC2Action, PayrollC2CommandRead } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollDayworkRecordDraft } from '../../app/lib/payroll/central-daywork-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { payrollCommandRecoveryScope } from '../../app/lib/payroll/command-recovery-scope'

import { EMPTY_WORKER_PRIVATE } from '../../app/lib/worker-roster/contract'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { createProductionPayrollImport } from '../../server/utils/production-payroll-import'
import { createProductionPayrollService } from '../../server/utils/production-payroll-service'
import { validateProductionPayrollState } from '../../server/utils/production-payroll-validation'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

async function fixture() {
  const base = resolve('.tmp/opt02-payroll-production')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const options = { directory, workspaceId: 'payroll-workspace', ownerId: 'payroll-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['payroll:read', 'payroll:write', 'worker:list:read', 'crew:list:read', 'project:list:read'] }
  const now = '2026-10-07T08:00:00.000Z'
  await storage.withTransaction(async (db) => {
    for (const id of ['payroll-project', 'unrelated-project'])
      await db.execute('INSERT INTO projects(id,name,code,draft_json,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)', [id, id, id, JSON.stringify({ id, name: id, code: id }), now, now])
    const crew = { id: 'payroll-crew', version: 1, updatedAt: now, draft: { id: 'payroll-crew', name: '真实时工班组' } }
    await db.execute('INSERT INTO crews(id,record_json) VALUES (?,?)', [crew.id, JSON.stringify(crew)])
    for (const [id, dailyWage, deletedAt] of [['payroll-leader', 481, null], ['payroll-zero', 0, null], ['payroll-other-project', 400, null], ['payroll-deleted', 999, now]] as const) {
      const worker = { id, version: 1, updatedAt: now, deletedAt, draft: { id, name: id, crewId: crew.id, currentProjectId: id === 'payroll-other-project' ? 'unrelated-project' : 'payroll-project', dailyWage } }
      await db.execute('INSERT INTO workers(id,record_json) VALUES (?,?)', [id, JSON.stringify(worker)])
    }
  })
  const owner = createProductionPayrollService(storage)
  const service = owner.forSession(() => actor)
  const scope = { projectId: 'payroll-project', crewId: 'payroll-crew', month: '2026-08' }
  const draft = { ...scope, leaderWorkerId: 'payroll-leader', memberWorkerIds: ['payroll-leader', 'payroll-zero'], note: '独立正式工资' }
  let sequence = 0
  const command = (read: PayrollC1CommandRead, action: PayrollC1Action) => ({ commandId: `payroll-test-${++sequence}`, workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: scope.projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  return { storage, options, actor, owner, service, scope, draft, command }
}

it('正式C2签工、P7原执行、P4真实补退、正式编号、固定名册原件及完整目录同盘保全并独立进程冷恢复', async () => {
  const f = await fixture()
  try {
    f.actor.capabilities.push('worker:write', 'worker:sensitive:read')
    const service = f.service
    let sequence = 0
    const draft = { ...f.draft, note: '正式C2与全部固定引用' }
    const c2 = (read: PayrollC2CommandRead, action: PayrollC2Action) => ({ commandId: `formal-c2-chain-${++sequence}`, ...f.actor, capabilities: undefined, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: f.scope.projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, configId: 'scope' in read ? read.config?.id ?? null : null, action })
    // Closed commands contain authority identity, never caller-provided capability arrays.
    const command = (read: PayrollC2CommandRead, action: PayrollC2Action) => {
      const { capabilities: _unused, ...body } = c2(read, action)
      return body
    }
    const config = await service.c2Config({ origin: 'real' }, { projectId: f.scope.projectId, leaderWorkerId: draft.leaderWorkerId })
    await service.executeC2(command(config, { kind: 'save-c2-config', config: { crewId: f.scope.crewId, unitRate: 1000, ruleText: '独立签工报价' } }))
    const daywork: PayrollDayworkRecordDraft = { projectId: f.scope.projectId, crewId: f.scope.crewId, workerId: draft.leaderWorkerId, workDate: '2026-08-03', workContent: '原实际签工', startTime: '08:00', endTime: '17:00', laborUnits: 1, witness: '原见证人', confirmedOn: '2026-08-04', status: 'confirmed', note: '' }
    const dayRead = await service.dayworkForm({ origin: 'real' }, { recordId: null, draftKey: 'formal-daywork-chain', draft: daywork })
    await service.executeDaywork({ commandId: 'formal-daywork-chain', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: dayRead.context.sourceVersion, projectId: f.scope.projectId, recordId: null, draftKey: dayRead.draftKey, originalScope: null, action: { kind: 'save-daywork', record: daywork } })
    const initial = await service.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'formal-c2-chain-draft', draft })
    const saved = await service.executeC2(command(initial, { kind: 'save-c2-draft', draft }))
    const current = () => service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    await service.executeC2(command(await current(), { kind: 'check-c2' }))
    const query = { origin: 'real' as const, projectId: f.scope.projectId, month: f.scope.month }
    const preview = await service.batchPreview(query, { purpose: 'release', projectId: f.scope.projectId, month: f.scope.month, statementIds: [saved.statementId!], fundingAmountFen: 100000 })
    expect(preview.items[0]!.eligibleAmountFen).toBe(100000)
    const batchIdentity = { schemaVersion: 1 as const, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const }
    const plan = await service.executeBatch({ ...batchIdentity, commandId: 'formal-c2-confirm-plan', action: { kind: 'confirm-batch', input: { purpose: 'release', projectId: f.scope.projectId, month: f.scope.month, previewVersion: preview.previewVersion, fundingAmountFen: 100000, items: [{ ...preview.items[0]!.target, decision: { kind: 'release', actualAmountFen: 100000, allocations: [{ workerId: draft.leaderWorkerId, amountFen: 100000 }, { workerId: 'payroll-zero', amountFen: 0 }] } }] } } })
    const prepared = await service.executeBatch({ ...batchIdentity, commandId: 'formal-c2-prepare-plan', action: { kind: 'prepare-batch-item', input: { planId: plan.planId, planVersion: plan.planVersion, executeCommandId: 'formal-c2-original-execution' } } })
    const execution = { ...batchIdentity, commandId: 'formal-c2-original-execution', action: { kind: 'execute-batch-original' as const, input: { planId: plan.planId, planVersion: prepared.planVersion } } }
    const complete = await service.executeBatch(execution)
    expect(complete.state).toBe('complete')
    expect(await service.executeBatch(execution)).toEqual(complete)
    const frozen = await service.c2Output({ origin: 'real' }, saved.statementId!)
    expect(frozen.document?.actualAmount).toBe(1000)
    const target = { adjustmentId: null, draftKey: 'formal-correction-chain', originalStatementId: saved.statementId! } as const
    const base = await service.adjustmentForm({ origin: 'real' }, { target })
    if (base.draft.basis?.formatFamily !== 'C2')
      throw new Error('正式更正须读取原C2依据')
    const correction = { ...base.draft, reason: '原单报价录入多100元', evidenceNote: '核对原签工和负责人报价', basis: { ...base.draft.basis, unitRate: 900 } }
    const corrected = await service.adjustmentForm({ origin: 'real' }, { target, draft: correction })
    const adjustmentIdentity = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.scope.projectId }
    const adjustment = await service.executeAdjustment({ ...adjustmentIdentity, commandId: 'formal-save-correction', sourceVersion: corrected.context.sourceVersion, target, action: { kind: 'save-adjustment-draft', draft: correction } })
    const confirmation = await service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: adjustment.adjustmentId! } })
    await service.executeAdjustment({ ...adjustmentIdentity, commandId: 'formal-confirm-correction', sourceVersion: confirmation.context.sourceVersion, target: confirmation.target, action: { kind: 'confirm-adjustment' } })
    const paymentTarget = { kind: 'actual-payment' as const, draftKey: 'formal-refund-chain', adjustmentIds: [adjustment.adjustmentId!] }
    const paymentInitial = await service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget })
    const payment = { kind: 'refund' as const, occurredOn: '2026-08-05', amount: -40, evidenceNote: '已收到真实退款40元', allocations: [{ workerId: draft.leaderWorkerId, amount: -40 }], applications: [{ adjustmentId: adjustment.adjustmentId!, amount: -40, balanceVersion: paymentInitial.balances[0]!.balanceVersion }] }
    const paymentRead = await service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget, draft: payment })
    const refundCommand = { ...adjustmentIdentity, commandId: 'formal-original-refund', sourceVersion: paymentRead.context.sourceVersion, target: paymentTarget, action: { kind: 'confirm-actual-payment' as const, payment } }
    const refund = await service.executeAdjustment(refundCommand)
    expect(await service.executeAdjustment(refundCommand)).toEqual(refund)
    expect((await service.actualLedger(query, { projectId: f.scope.projectId })).netAmount.value).toBe(960)
    expect((await service.adjustmentDetail(query, adjustment.adjustmentId!)).balance.remainingDelta.value).toBe(-60)
    expect((await service.c2Output({ origin: 'real' }, saved.statementId!)).document).toEqual(frozen.document)
    const numberInput = { projectId: f.scope.projectId, statementId: saved.statementId! }
    const numberCommand = (read: Awaited<ReturnType<typeof service.numbering>>, id: string, action: { kind: 'initialize', nextNumber: number, evidenceNote: string } | { kind: 'issue' }) => ({ schemaVersion: 1 as const, commandId: id, ...adjustmentIdentity, statementId: saved.statementId!, sourceVersion: read.context.sourceVersion, action })
    await service.executeNumbering(numberCommand(await service.numbering(query, numberInput), 'formal-number-start', { kind: 'initialize', nextNumber: 128, evidenceNote: '原纸质正式号核对至127' }))
    await service.executeNumbering(numberCommand(await service.numbering(query, numberInput), 'formal-number-issue', { kind: 'issue' }))
    const master = createProductionCrewWorkerService(f.storage)
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    for (const workerId of draft.memberWorkerIds) {
      const profile = await master.profile(workerId, () => f.actor)
      await master.executeRoster({ commandId: `formal-photo-${workerId}`, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real', action: 'save-profile', workerId, sourceVersion: profile.sourceVersion, values: { ...EMPTY_WORKER_PRIVATE, laborContractSigned: false }, uploads: { 'portrait': { fileName: '肖像.png', mimeType: 'image/png', fileSize: 68, payloadBase64: png }, 'bank-card': { fileName: '银行卡.png', mimeType: 'image/png', fileSize: 68, payloadBase64: png } } }, () => f.actor)
    }
    const rosterScope = { projectId: f.scope.projectId, statementIds: [saved.statementId!], registeredOn: '2026-08-08' }
    const rosterPreview = await master.rosterPreview(rosterScope, () => f.actor)
    const roster = await master.executeRoster({ commandId: 'formal-fixed-roster', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real', action: 'archive', scope: rosterScope, sourceVersion: rosterPreview.sourceVersion }, () => f.actor)
    const workbook = f.owner.workbook(() => f.actor)
    const input = { projectId: f.scope.projectId, mode: 'project-month' as const, statementIds: [saved.statementId!], rosterArchiveId: roster.archiveId! }
    const output = await workbook.workbookPreview(query, input)
    const archived = await workbook.executeWorkbook({ schemaVersion: 1, commandId: 'formal-fixed-directory', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: output.sourceVersion, input, action: 'archive' })
    const refs = await f.storage.select<{ table_name: string }>('SELECT table_name FROM payroll_workbook_references WHERE archive_id=?', [archived.archiveId])
    expect(refs.map(row => row.table_name)).toEqual(expect.arrayContaining(['wage_statements', 'payroll_actual_events', 'payroll_actual_allocations', 'payroll_adjustments', 'payroll_official_issues', 'worker_roster_archives', 'worker_roster_assets', 'file_refs']))
    await f.storage.withTransaction(db => validateProductionPayrollState(db))
    const descriptor = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'payroll', commandId: refundCommand.commandId, targetId: null, action: refundCommand.action.kind, scopeId: payrollCommandRecoveryScope(refundCommand) }
    await expect(f.owner.resolve({ ...descriptor, scopeId: payrollCommandRecoveryScope({ ...refundCommand, target: { ...paymentTarget, draftKey: 'another-book' } }) }, () => f.actor)).rejects.toThrow('范围')
    await f.storage.close()
    const child = await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('tests/helpers/production-payroll-cold-process.ts')], { windowsHide: true, cwd: resolve('.'), env: { ...process.env, CRM_PAYROLL_COLD_DIRECTORY: f.options.directory, CRM_PAYROLL_COLD_DESCRIPTOR: JSON.stringify(descriptor), CRM_PAYROLL_COLD_CHAIN: JSON.stringify({ projectId: f.scope.projectId, statementId: saved.statementId, archiveId: archived.archiveId, rosterId: roster.archiveId, planId: plan.planId }) } })
    expect(JSON.parse(child.stdout)).toMatchObject({ recovered: { outcome: 'applied', result: refund }, chain: { netAmount: 960, statement: { actualAmount: 1000 }, plan: { state: 'complete' }, directory: { id: archived.archiveId }, roster: { id: roster.archiveId } } })
  }
  finally { await f.storage.close() }
}, 30000)

it('正式工资只读真实主档，保软删除、不懒建表，C1不要求工程量或合同来源', async () => {
  const f = await fixture()
  try {
    const before = await f.storage.select('SELECT id,record_json FROM workers ORDER BY id')
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, f.scope)
    expect(matrix.workers.map(row => row.id)).toEqual(expect.arrayContaining(['payroll-leader', 'payroll-zero']))
    expect(matrix.workers.map(row => row.id)).not.toContain('payroll-deleted')
    expect(await f.storage.select('SELECT id,record_json FROM workers ORDER BY id')).toEqual(before)
    const changedSql: string[] = []
    await f.storage.withTransaction(async (tx) => {
      const { productionPayrollInTransaction } = await import('../../server/utils/production-payroll-service')
      const service = productionPayrollInTransaction({ select: tx.select, execute: async (sql, parameters) => {
        changedSql.push(sql)
        await tx.execute(sql, parameters)
      } }, () => f.actor)
      await service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'independent-c1', draft: f.draft })
    })
    expect(changedSql).toEqual([])
  }
  finally { await f.storage.close() }
})

it('完整真实SQLite经明确主档版本映射接管完整C1冻结，保原JSON未知扩展、零成员、来源原键与后来更正', async () => {
  const f = await fixture()
  const native = await createPayrollC1ServiceFixture()
  try {
    await native.attendance()
    const draft = { ...native.draft, memberWorkerIds: ['w', 'zero'] }
    const saved = await native.service.executeC1(native.command(await native.form(draft), { kind: 'save-c1-draft', draft }))
    let read = await native.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await native.service.executeC1(native.command(read, { kind: 'check-c1' }))
    read = await native.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await native.service.executeC1(native.command(read, { kind: 'release-c1', release: { actualAmount: 601.25, allocations: [{ workerId: 'w', amount: 601.25 }, { workerId: 'zero', amount: 0 }] } }))
    const [head] = await native.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [saved.statementId])
    const raw = JSON.stringify({ ...JSON.parse(head!.snapshot_json), unknownFuture: { opaque: ['original-identity', 0, null] } })
    await native.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [raw, saved.statementId])
    await native.db.execute('ALTER TABLE wage_statements ADD COLUMN unknown_large_integer INTEGER')
    await native.db.execute('ALTER TABLE wage_statements ADD COLUMN unknown_blob BLOB')
    await native.db.execute('UPDATE wage_statements SET unknown_large_integer=9007199254740993,unknown_blob=X\'00FF10\' WHERE id=?', [saved.statementId])
    const bytes = native.db.raw.export()
    const source = { payloadBase64: Buffer.from(bytes).toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
    const actor = { ...f.actor, capabilities: [...f.actor.capabilities, 'core:migration:write', 'worker:sensitive:read'] }
    const owner = createProductionPayrollImport(f.storage)
    const state = await owner.state(() => actor)
    const bindings = [['projects', 'p', 'payroll-project'], ['crews', 'crew', 'payroll-crew'], ['workers', 'w', 'payroll-leader'], ['workers', 'zero', 'payroll-zero']] as const
    const referenceMappings = bindings.map(([entityType, legacyId, serverId]) => {
      const target = state.references.find(row => row.entityType === entityType && row.serverId === serverId)!
      return { entityType, legacyId, serverId, version: target.version, sourceVersion: target.sourceVersion, evidenceNote: '真实稳定身份逐项核对' }
    })
    const command = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'native-c1-adopt', action: 'adopt' as const, source, referenceMappings }
    const masters = await f.storage.select('SELECT id,record_json FROM workers ORDER BY id')
    const preview = await owner.execute({ ...command, action: 'preview', commandId: 'native-c1-preview' }, () => actor)
    expect(preview).toMatchObject({ eligible: true, sourceSha256: source.sha256 })
    expect(await f.storage.select('SELECT * FROM wage_statements')).toEqual([])
    const result = await owner.execute(command, () => actor)
    expect(result).toMatchObject({ sourceSha256: source.sha256, projectIds: ['payroll-project'] })
    expect('statementIds' in result).toBe(true)
    if (!('statementIds' in result))
      throw new Error('未取得完整工资迁入结果')
    const output = await f.service.c1Output({ origin: 'real' }, result.statementIds[0]!)
    expect(output.state).toBe('available')
    expect(output.document?.actualAmount).toBe(601.25)
    expect(output.document?.members).toEqual(expect.arrayContaining([expect.objectContaining({ workerId: 'payroll-zero', workerName: '零成员' })]))
    const retained = await f.storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [result.statementIds[0]])
    expect(retained[0]!.snapshot_json).toBe(raw)
    const [sourceRecord] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM payroll_source_imports')
    const domain = JSON.parse(sourceRecord!.evidence_json).domainEvidence
    const originalColumns = domain.rows.wage_statements.find((row: { legacyId: string }) => row.legacyId === saved.statementId).columns
    expect(originalColumns.unknown_large_integer).toEqual({ sqliteType: 'integer', exactValue: '9007199254740993', rawHex: null })
    expect(originalColumns.unknown_blob).toEqual({ sqliteType: 'blob', exactValue: '00FF10', rawHex: '00FF10' })
    expect(originalColumns.snapshot_json.exactValue).toBe(raw)
    expect(sourceRecord!.evidence_json).not.toContain(source.payloadBase64)
    expect(await f.storage.select('SELECT id,record_json FROM workers ORDER BY id')).toEqual(masters)
    expect(await owner.execute(command, () => actor)).toEqual(result)
    expect(await f.storage.select('SELECT id FROM wage_statements')).toEqual(result.statementIds.map(id => ({ id })))
    await f.storage.withTransaction(db => validateProductionPayrollState(db))
    await expect(owner.execute({ ...command, commandId: 'native-c1-bad-sha', source: { ...source, sha256: '0'.repeat(64) } }, () => actor)).rejects.toThrow('摘要')
    expect(await owner.resolve(command.commandId, () => actor)).toEqual({ outcome: 'applied', result })
  }
  finally {
    await f.storage.close()
    await native.close()
  }
})

it('实际C1发放、零成员、冻结配对、原键及明确封存同盘冷读，无关主档变化不作保存冲突', async () => {
  const f = await fixture()
  try {
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, f.scope)
    await f.service.executeAttendance({ commandId: 'attendance-original', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real', requiredCapability: 'payroll:write', projectId: f.scope.projectId, sourceVersion: matrix.context.sourceVersion, scope: f.scope, action: { kind: 'upsert-attendance', record: { workerId: 'payroll-leader', crewId: f.scope.crewId, workDate: '2026-08-01', hours: 8, overtimeHours: 2, workContent: '原工时', note: '' } } })
    const preview = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'new-payroll', draft: f.draft })
    expect(preview.totals.grossAmount.value).toBe(601.25)
    await f.storage.withTransaction(db => db.execute('UPDATE projects SET name=? WHERE id=?', ['另一项目合法改名', 'unrelated-project']))
    const saved = await f.service.executeC1(f.command(preview, { kind: 'save-c1-draft', draft: f.draft }))
    let current = await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.executeC1(f.command(current, { kind: 'check-c1' }))
    current = await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    const original = f.command(current, { kind: 'release-c1', release: { actualAmount: 601.25, allocations: [{ workerId: 'payroll-leader', amount: 601.25 }, { workerId: 'payroll-zero', amount: 0 }] } })
    const result = await f.service.executeC1(original)
    expect(result.outcome).toBe('released')
    await f.storage.withTransaction(db => validateProductionPayrollState(db))
    expect(await f.service.executeC1(original)).toEqual(result)
    const output = await f.service.c1Output({ origin: 'real' }, saved.statementId!)
    expect(output.state).toBe('available')
    expect(output.document?.allocations).toEqual(expect.arrayContaining([expect.objectContaining({ workerId: 'payroll-zero', allocatedAmountFen: 0 })]))
    const restrictedActor = { ...f.actor, capabilities: ['payroll:read', 'payroll:write'] }
    const restricted = f.owner.forSession(() => restrictedActor)
    await expect(restricted.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'forbidden-lookup', draft: f.draft })).rejects.toThrow('独立')
    expect((await restricted.c1Output({ origin: 'real' }, saved.statementId!)).document).toEqual(output.document)
    const restrictedMatrix = await restricted.attendanceMatrix({ origin: 'real' }, f.scope)
    expect(restrictedMatrix.records).not.toEqual([])
    expect(restrictedMatrix.workers.map(worker => worker.id)).not.toContain('payroll-other-project')
    expect((restrictedMatrix.options as typeof restrictedMatrix.options & { availability: { workers: string } }).availability.workers).toBe('forbidden')
    expect(restrictedMatrix.context.readonly).toBe(true)
    await f.storage.close()
    const child = await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('tests/helpers/production-payroll-cold-process.ts')], { windowsHide: true, cwd: resolve('.'), env: { ...process.env, CRM_PAYROLL_COLD_DIRECTORY: f.options.directory, CRM_PAYROLL_COLD_DESCRIPTOR: JSON.stringify({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'payroll', commandId: original.commandId, targetId: original.statementId, action: original.action.kind }) } })
    expect(JSON.parse(child.stdout)).toMatchObject({ recovered: { outcome: 'applied', result }, output: { state: 'available' } })
    const coldStorage = createProductionStorage(f.options)
    try {
      const cold = createProductionPayrollService(coldStorage)
      const resolved = await cold.resolve({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'payroll', commandId: original.commandId, targetId: original.statementId, action: original.action.kind }, () => f.actor)
      expect(resolved).toMatchObject({ outcome: 'applied', result })
      expect((await cold.forSession(() => f.actor).c1Output({ origin: 'real' }, saved.statementId!)).state).toBe('available')
      await expect(coldStorage.execute('UPDATE wage_statements SET actual_amount=0 WHERE id=?', [saved.statementId])).rejects.toThrow('Released payroll')
      const descriptor = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'payroll', commandId: 'sealed-late-payroll', targetId: null, action: 'save-c1-draft' }
      expect(await cold.resolve(descriptor, () => f.actor)).toEqual({ outcome: 'not-applied', commandId: descriptor.commandId })
      await expect(cold.forSession(() => f.actor).executeC1({ ...original, commandId: descriptor.commandId, statementId: null, action: { kind: 'save-c1-draft', draft: f.draft } })).rejects.toThrow('封存')
    }
    finally { await coldStorage.close() }
  }
  finally { await f.storage.close() }
})

it('当前项目分配变化不影响明确旧项目C1输入，真实日薪与班组资格变化仍使原依据失效', async () => {
  const f = await fixture()
  try {
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, f.scope)
    await f.service.executeAttendance({ commandId: 'existing-project-attendance', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real', requiredCapability: 'payroll:write', projectId: f.scope.projectId, sourceVersion: matrix.context.sourceVersion, scope: f.scope, action: { kind: 'upsert-attendance', record: { workerId: 'payroll-leader', crewId: f.scope.crewId, workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '旧项目原工时', note: '' } } })
    const original = await f.service.c1Form({ origin: 'real' }, { statementId: null, draftKey: 'moving-person', draft: f.draft })
    const move = async (values: Record<string, unknown>) => f.storage.withTransaction(async (db) => {
      const [row] = await db.select<{ record_json: string }>('SELECT record_json FROM workers WHERE id=?', ['payroll-leader'])
      const record = JSON.parse(row!.record_json)
      record.version++
      Object.assign(record.draft, values)
      await db.execute('UPDATE workers SET record_json=? WHERE id=?', [JSON.stringify(record), 'payroll-leader'])
    })
    await move({ currentProjectId: 'unrelated-project' })
    const saved = await f.service.executeC1(f.command(original, { kind: 'save-c1-draft', draft: f.draft }))
    const sameProject = await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    expect(sameProject.facts[0]?.projectId).toBe('payroll-project')
    expect(sameProject.totals.grossAmount.value).toBe(481)
    await move({ dailyWage: 482 })
    await expect(f.service.executeC1(f.command(sameProject, { kind: 'check-c1' }))).rejects.toThrow('个人标准')
    const afterPrice = await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await move({ crewId: null })
    await expect(f.service.executeC1(f.command(afterPrice, { kind: 'check-c1' }))).rejects.toThrow()
  }
  finally { await f.storage.close() }
})

it('同项目只核实际工人和日期，未采用工人与另日变化可保存，原格变化仍拒绝', async () => {
  const f = await fixture()
  try {
    let seq = 0
    const initial = await f.service.attendanceMatrix({ origin: 'real' }, f.scope)
    const attendance = (basis: typeof initial, workerId: string, workDate: string, hours = 8) => ({ commandId: `selected-attendance-${++seq}`, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.scope.projectId, sourceVersion: basis.context.sourceVersion, scope: f.scope, action: { kind: 'upsert-attendance' as const, record: { workerId, crewId: f.scope.crewId, workDate, hours, overtimeHours: 0, workContent: '选择的原格', note: '' } } })
    expect(initial.workers.map(worker => worker.id)).toContain('payroll-other-project')
    await f.service.executeAttendance(attendance(initial, 'payroll-other-project', '2026-08-02'))
    await f.service.executeAttendance(attendance(initial, 'payroll-leader', '2026-08-02'))
    const saved = await f.service.executeAttendance(attendance(initial, 'payroll-leader', '2026-08-01'))
    const stale = await f.service.attendanceMatrix({ origin: 'real' }, f.scope)
    await f.service.executeAttendance(attendance(stale, 'payroll-leader', '2026-08-01', 7))
    await expect(f.service.executeAttendance(attendance(stale, 'payroll-leader', '2026-08-01', 6))).rejects.toThrow('原记录')
    expect((await f.storage.select<{ hours: number }>('SELECT hours FROM attendance_records WHERE id=?', [saved.recordId]))[0]!.hours).toBe(7)
    const workersBefore = await f.storage.select<{ record_json: string }>('SELECT record_json FROM workers WHERE id=?', ['payroll-other-project'])
    const relation = await f.storage.select<{ project_id: string, worker_id: string }>('SELECT project_id,worker_id FROM attendance_records WHERE worker_id=?', ['payroll-other-project'])
    expect(relation).toEqual([expect.objectContaining({ project_id: 'payroll-project', worker_id: 'payroll-other-project' })])
    expect(await f.storage.select('SELECT record_json FROM workers WHERE id=?', ['payroll-other-project'])).toEqual(workersBefore)
  }
  finally { await f.storage.close() }
})

it('c1部分标准只核所选工人标准、资格和月锁，另一工人新标准不造成冲突', async () => {
  const f = await fixture()
  try {
    const baseline = await f.service.c1Config({ origin: 'real' }, f.scope)
    await f.service.executeC1(f.command(baseline, { kind: 'save-c1-rates', rates: [{ workerId: 'payroll-zero', dailyWage: 0, overtimeRate: 12.5 }] }))
    const saved = await f.service.executeC1(f.command(baseline, { kind: 'save-c1-rates', rates: [{ workerId: 'payroll-leader', dailyWage: null, overtimeRate: 60.125 }] }))
    expect(saved.rateRevisionIds).not.toEqual([])
    const selected = await f.service.c1Config({ origin: 'real' }, f.scope)
    await f.service.executeC1(f.command(selected, { kind: 'save-c1-rates', rates: [{ workerId: 'payroll-leader', dailyWage: null, overtimeRate: 55 }] }))
    await expect(f.service.executeC1(f.command(selected, { kind: 'save-c1-rates', rates: [{ workerId: 'payroll-leader', dailyWage: null, overtimeRate: 54 }] }))).rejects.toThrow('工资标准')
    expect((await f.service.c1Config({ origin: 'real' }, f.scope)).rates.find(rate => rate.workerId === 'payroll-leader')?.overtimeRate).toBe(55)
  }
  finally { await f.storage.close() }
})

it('只有原intent且无领域回执时冷resolve封存未应用，迟到请求不能变成一次新工资保存', async () => {
  const f = await fixture()
  try {
    await f.storage.execute('CREATE TRIGGER synthetic_domain_failure BEFORE INSERT ON attendance_records BEGIN SELECT RAISE(ABORT,\'synthetic-before-domain-write\'); END')
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, f.scope)
    const original = { commandId: 'intent-only-attendance', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.scope.projectId, sourceVersion: matrix.context.sourceVersion, scope: f.scope, action: { kind: 'upsert-attendance' as const, record: { workerId: 'payroll-leader', crewId: f.scope.crewId, workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '不得冷恢复新保存', note: '' } } }
    await expect(f.service.executeAttendance(original)).rejects.toThrow('synthetic-before-domain-write')
    expect(await f.storage.select('SELECT * FROM attendance_records')).toEqual([])
    expect(await f.storage.select('SELECT * FROM payroll_command_journal')).toEqual([])
    await f.storage.execute('DROP TRIGGER synthetic_domain_failure')
    await f.storage.close()
    const owner = createProductionPayrollService(f.storage)
    expect(await owner.resolve({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'payroll', commandId: original.commandId, targetId: null, action: original.action.kind, scopeId: payrollCommandRecoveryScope(original) }, () => f.actor)).toEqual({ outcome: 'not-applied', commandId: original.commandId })
    await expect(owner.forSession(() => f.actor).executeAttendance(original)).rejects.toThrow('未应用')
    expect(await f.storage.select('SELECT * FROM attendance_records')).toEqual([])
  }
  finally { await f.storage.close() }
})

it('外层原结果写入故障与领域事实、审计、版本及原回执一起回滚，核对后整号封存', async () => {
  const f = await fixture()
  try {
    const matrix = await f.service.attendanceMatrix({ origin: 'real' }, f.scope)
    const before = await f.storage.select('SELECT * FROM payroll_revision')
    const original = { commandId: 'journal-atomic-attendance', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.scope.projectId, sourceVersion: matrix.context.sourceVersion, scope: f.scope, action: { kind: 'upsert-attendance' as const, record: { workerId: 'payroll-leader', crewId: f.scope.crewId, workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '原子提交', note: '' } } }
    await f.storage.execute('CREATE TRIGGER synthetic_journal_failure BEFORE INSERT ON payroll_command_journal BEGIN SELECT RAISE(ABORT,\'synthetic-before-journal-commit\'); END')
    await expect(f.service.executeAttendance(original)).rejects.toThrow('synthetic-before-journal-commit')
    expect(await f.storage.select('SELECT * FROM attendance_records')).toEqual([])
    expect(await f.storage.select('SELECT * FROM payroll_command_receipts')).toEqual([])
    expect(await f.storage.select('SELECT * FROM operation_logs')).toEqual([])
    expect(await f.storage.select('SELECT * FROM payroll_revision')).toEqual(before)
    await f.storage.execute('DROP TRIGGER synthetic_journal_failure')
    expect(await f.owner.resolve({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'payroll', commandId: original.commandId, targetId: null, action: original.action.kind, scopeId: payrollCommandRecoveryScope(original) }, () => f.actor)).toEqual({ outcome: 'not-applied', commandId: original.commandId })
    await expect(f.service.executeAttendance(original)).rejects.toThrow('未应用')
  }
  finally { await f.storage.close() }
})
