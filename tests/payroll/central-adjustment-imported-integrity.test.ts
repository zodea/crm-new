import type { PayrollAdjustmentAction, PayrollCorrectionCommand } from '../../app/lib/payroll/central-adjustment-contract'
import type { TestDb } from '../helpers/memory-db'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { decodePayrollC1Read, encodePayrollC1Wire } from '../../app/lib/payroll/central-c1-codec'
import { decodePayrollC2Read, encodePayrollC2Wire } from '../../app/lib/payroll/central-c2-codec'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAAdjustmentFixture } from '../helpers/payroll-a-adjustment-fixture'
import { createPayrollAOutputMigrationFixture } from '../helpers/payroll-a-output-migration-fixture'
import { createPayrollAdjustmentMigrationFixture } from '../helpers/payroll-adjustment-migration-fixture'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

async function releasedFixture(family: 'A' | 'C1') {
  if (family === 'A')
    return createPayrollAAdjustmentFixture()
  const f = await createPayrollC1ServiceFixture()
  try {
    f.source.workers.find(worker => worker.id === 'w')!.dailyWage = 1000
    await f.service.executeC1(f.command(await f.config(), { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: 1000, overtimeRate: null }, { workerId: 'member', dailyWage: 0, overtimeRate: null }, { workerId: 'zero', dailyWage: 0, overtimeRate: null }] }))
    await f.attendance({ overtimeHours: 0 })
    const saved = await f.service.executeC1(f.command(await f.form(), { kind: 'save-c1-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const read = () => f.service.c1Form({ origin: 'real' }, { statementId })
    await f.service.executeC1(f.command(await read(), { kind: 'check-c1' }))
    await f.service.executeC1(f.command(await read(), { kind: 'release-c1', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } }))
    return { ...f, statementId }
  }
  catch (cause) {
    await f.close()
    throw cause
  }
}

async function importOriginal(original: { db: TestDb }) {
  const source = await readQuantityCoreSource(original.db)
  const bytes = original.db.raw.export()
  const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
  const session = resolveBusinessSession()
  const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
  await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('integrity-preflight'), source, backup: null }), session)
  const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('integrity-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
  await coreMigrationTestInstance.importBatch({ ...envelope('integrity-import'), batchId: batch.batchId }, session)
  await coreMigrationTestInstance.confirm({ ...envelope('integrity-confirm'), batchId: batch.batchId }, session)
  const projectId = batch.mappings.find(m => m.entityType === 'projects' && m.legacyId === 'p')!.serverId
  const evidence = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<{ mapping_json: string }>('SELECT mapping_json FROM payroll_migration_evidence WHERE project_id=?', [projectId]))[0]!)
  const mappings: Array<{ tableName: string, legacyId: string, centralId: string | null }> = JSON.parse(evidence.mapping_json)
  const mappedId = (tableName: string, legacyId: string) => mappings.find(m => m.tableName === tableName && m.legacyId === legacyId)?.centralId ?? null
  return { projectId, mappedId }
}

it.each(['A', 'C1'] as const)('原 %s 班组与冻结主体不一致时不得把改后班组认作原工资事实', async (family) => {
  const f = await releasedFixture(family)
  try {
    const before = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(before.status).toBe('complete')
    expect(before.rows[0]!.historicalMembers[0]!.crewId).toBe('crew')
    await f.db.execute('UPDATE wage_statements SET crew_id=NULL WHERE id=?', [f.statementId])
    let value
    try {
      value = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    }
    catch (cause) {
      expect(cause).toMatchObject({ problem: { code: 'unavailable' } })
      return
    }
    expect(value.status).not.toBe('complete')
  }
  finally { await f.close() }
})

it('原实际事件新增矛盾分配后，缓存不得继续给完整净额', async () => {
  const f = await createPayrollAdjustmentMigrationFixture()
  const query = { origin: 'real' as const, projectId: f.projectId }
  expect((await f.service.actualLedger(query, { projectId: f.projectId })).status).toBe('complete')
  await f.instance.withWorkspaceTransaction(async (tx) => {
    await tx.execute('INSERT INTO payroll_actual_allocations(id,event_id,worker_id,signed_amount_fen,proof_json) VALUES(?,?,?,?,?)', ['unexpected-allocation', f.eventId, f.mappedId('workers', 'zero'), -1, JSON.stringify({ workerId: f.mappedId('workers', 'zero'), workerName: '零成员', crewId: f.mappedId('crews', 'crew') })])
  })
  let value
  try {
    value = await f.service.actualLedger(query, { projectId: f.projectId })
  }
  catch (cause) {
    expect(cause).toMatchObject({ problem: { code: 'unavailable' } })
    return
  }
  expect(value.status).not.toBe('complete')
})

it.each(['head', 'member'] as const)('同原图隔离旧 B 的 %s 不阻断合格现代工资和退款', async (isolatedPart) => {
  const original = await createPayrollAdjustmentFixture()
  try {
    const correction = await original.correct()
    await original.refund(correction.adjustment.id, 40)
    const [old] = await original.db.select<Record<string, unknown>>('SELECT * FROM wage_statements WHERE id=?', [original.statementId])
    const legacy = { ...old, id: 'isolated-old-b', leader_worker_id: isolatedPart === 'head' ? 'unmapped-legacy-worker' : 'w', subject_config_id: null, month: '2026-07', format_family: 'B', snapshot_json: null }
    await original.db.execute('PRAGMA foreign_keys=OFF')
    await original.db.execute(`INSERT INTO wage_statements(${Object.keys(legacy).join(',')}) VALUES(${Object.keys(legacy).map(() => '?').join(',')})`, Object.values(legacy))
    if (isolatedPart === 'member')
      await original.db.execute('INSERT INTO wage_statement_members(id,statement_id,worker_id,is_leader) VALUES(?,?,?,?)', ['isolated-old-member', 'isolated-old-b', 'unmapped-legacy-worker', 0])
    const { projectId, mappedId } = await importOriginal(original)
    const isolatedId = isolatedPart === 'head' ? 'isolated-old-b' : 'isolated-old-member'
    expect(mappedId(isolatedPart === 'head' ? 'wage_statements' : 'wage_statement_members', isolatedId)).toBeNull()
    const actual = await payrollService.actualLedger({ origin: 'real', projectId }, { projectId })
    expect(actual.netAmount.value).toBe(960)
  }
  finally { await original.close() }
})

it('未确认更正草稿迁入后仍以中央原引用读取并可确认，原正文证据保留', async () => {
  const original = await createPayrollAdjustmentFixture()
  try {
    const target = { adjustmentId: null, draftKey: 'unconfirmed-migration', originalStatementId: original.statementId } as const
    const initial = await original.service.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('C2 basis required')
    const draft = { ...initial.draft, reason: '单价核对更正', evidenceNote: '原草稿迁入后继续确认', basis: { ...initial.draft.basis, unitRate: 900 } }
    const preview = await original.service.adjustmentForm({ origin: 'real' }, { target, draft })
    const saved = await original.service.executeAdjustment(original.adjustmentCommand(preview, { kind: 'save-adjustment-draft', draft }))
    const { projectId, mappedId } = await importOriginal(original)
    const adjustmentId = mappedId('payroll_adjustments', saved.adjustmentId!)!
    const read = await payrollService.adjustmentForm({ origin: 'real', projectId }, { target: { adjustmentId } })
    expect(read.draft.basis).toMatchObject({ formatFamily: 'C2', configId: mappedId('payroll_subject_configs', draft.basis.configId), records: draft.basis.records.map(r => ({ recordId: mappedId('signed_daywork_records', r.recordId), workerId: mappedId('workers', r.workerId) })) })
    expect(read.eligibility.canConfirmAdjustment).toBe(true)
    const result = await payrollService.executeAdjustment({ commandId: 'confirm-imported-draft', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, target: read.target, action: { kind: 'confirm-adjustment' } })
    expect((await payrollService.adjustmentDetail({ origin: 'real', projectId }, result.adjustmentId!)).balance.remainingDelta.value).toBe(-100)
  }
  finally { await original.close() }
})

it.each(['A', 'C1', 'C2'] as const)('迁入后原 %s 冻结表保持原内容、可输出并经严格传输回读', async (family) => {
  const f = family === 'A' ? await createPayrollAOutputMigrationFixture() : family === 'C1' ? await releasedFixture('C1') : await createPayrollAdjustmentFixture()
  try {
    const old = family === 'A' ? await f.service.aOutput({ origin: 'real' }, f.statementId) : family === 'C1' ? await f.service.c1Output({ origin: 'real' }, f.statementId) : await f.service.c2Output({ origin: 'real' }, f.statementId)
    expect(old.state).toBe('available')
    const [raw] = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [f.statementId])
    const { projectId, mappedId } = await importOriginal(f)
    const statementId = mappedId('wage_statements', f.statementId)!
    const query = { origin: 'real' as const, projectId }
    const output = family === 'A' ? await payrollService.aOutput(query, statementId) : family === 'C1' ? await payrollService.c1Output(query, statementId) : await payrollService.c2Output(query, statementId)
    const read = family === 'A' ? await payrollService.aForm(query, { statementId }) : family === 'C1' ? await payrollService.c1Form(query, { statementId }) : await payrollService.c2Form(query, { statementId })
    expect(read).toMatchObject({ status: 'released', context: { readonly: !read.context.capabilities.includes('payroll:write') }, draft: { projectId, leaderWorkerId: mappedId('workers', 'w') }, eligibility: { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: true } })
    expect(output.state).toBe('available')
    if (!output.document || !old.document)
      throw new Error('原表和迁入表应可用')
    const previous = old.document
    expect(output.document).toMatchObject({ id: statementId, projectId, projectName: previous.projectName, crewName: previous.crewName, leaderName: previous.leaderName, month: previous.month, formatFamily: previous.formatFamily, periodKind: previous.periodKind, payRatio: previous.payRatio, grossAmount: previous.grossAmount, actualAmount: previous.actualAmount, releasedAt: previous.releasedAt, operatorName: previous.operatorName, note: previous.note, members: previous.members.map(member => ({ ...member, workerId: mappedId('workers', member.workerId) })), allocations: previous.allocations.map(member => ({ ...member, workerId: mappedId('workers', member.workerId) })), lines: previous.lines.map(line => ({ workerId: mappedId('workers', line.workerId), workerName: line.workerName, itemName: line.itemName, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount })) })
    if (output.document.formatFamily === 'A' && previous.formatFamily === 'A') {
      expect(output.document.lines[0]!.facts[0]).toMatchObject({ unitId: mappedId('units', 'output-unit'), fieldQty: 10, fieldFormula: '2*5', sourceFingerprint: previous.lines[0]!.facts[0]!.sourceFingerprint })
      expect(output.document.lines[0]!.sources[0]).toMatchObject({ subject: { id: mappedId('units', 'output-unit') }, filters: { projectId, completionId: mappedId('unit_stage_completions', 'output-completion') } })
      expect(decodePayrollARead(encodePayrollAWire(output), 'output', query, statementId)).toEqual(output)
      expect(decodePayrollARead(encodePayrollAWire(read), 'form', query, { statementId })).toEqual(read)
    }
    else if (output.document.formatFamily === 'C1' && previous.formatFamily === 'C1') {
      expect(output.document.attendance).toEqual(previous.attendance.map(fact => ({ ...fact, id: mappedId('attendance_records', fact.id), projectId, crewId: fact.crewId === null ? null : mappedId('crews', fact.crewId), workerId: mappedId('workers', fact.workerId) })))
      expect(decodePayrollC1Read(encodePayrollC1Wire(output), 'output', query, statementId)).toEqual(output)
      expect(decodePayrollC1Read(encodePayrollC1Wire(read), 'form', query, { statementId })).toEqual(read)
    }
    else if (output.document.formatFamily === 'C2' && previous.formatFamily === 'C2') {
      expect(output.document.daywork).toEqual(previous.daywork.map(fact => ({ ...fact, id: mappedId('signed_daywork_records', fact.id), projectId, crewId: fact.crewId === null ? null : mappedId('crews', fact.crewId), workerId: mappedId('workers', fact.workerId) })))
      expect(output.document.config.original).toEqual(previous.config.original)
      expect(output.document.config.sourceFingerprint).toBe(previous.config.sourceFingerprint)
      expect(decodePayrollC2Read(encodePayrollC2Wire(output), 'output', query, statementId)).toEqual(output)
      expect(decodePayrollC2Read(encodePayrollC2Wire(read), 'form', query, { statementId })).toEqual(read)
      const reject = (change: (document: typeof output.document & { formatFamily: 'C2' }) => void) => {
        const invalid = structuredClone(output)
        if (invalid.document?.formatFamily !== 'C2')
          throw new Error('C2 document required')
        change(invalid.document)
        expect(() => decodePayrollC2Read(encodePayrollC2Wire(invalid), 'output', query, statementId)).toThrow()
      }
      reject((document) => {
        document.identityMapping = undefined
      })
      reject((document) => {
        document.identityMapping!.pop()
      })
      reject((document) => {
        document.identityMapping!.push(document.identityMapping![0]!)
      })
      reject((document) => {
        document.daywork[0]!.original.work_content = '伪造原签工内容'
      })
      reject((document) => {
        document.config.original.unit_rate = 999
      })
      reject((document) => {
        document.allocations[0]!.amount += 1
      })
      reject((document) => {
        document.lines[0]!.id = '不一致的工资行'
      })
    }
    const [current] = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [statementId]))
    expect(current!.snapshot_json).toBe(raw!.snapshot_json)
  }
  finally { await f.close() }
})

it('迁入后续更正与冲销原退款，可经新原提交及老证明正确回读', async () => {
  const f = await createPayrollAdjustmentMigrationFixture()
  const query = { origin: 'real' as const, projectId: f.projectId }
  const target = { adjustmentId: null, draftKey: 'continue-original', originalStatementId: f.statementId } as const
  const initial = await f.service.adjustmentForm(query, { target })
  if (initial.draft.basis?.formatFamily !== 'C2')
    throw new Error('C2 required')
  const draft = { ...initial.draft, reason: '再次核对原单价', evidenceNote: '原更正900仍有误，核对为800', correctsAdjustmentId: f.adjustmentId, basis: { ...initial.draft.basis, unitRate: 800 } }
  const form = await f.service.adjustmentForm(query, { target, draft })
  const command = (read: typeof form, commandId: string, action: PayrollAdjustmentAction): PayrollCorrectionCommand => ({ commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: f.projectId, target: read.target, action })
  const saved = await f.service.executeAdjustment(command(form, 'continue-save', { kind: 'save-adjustment-draft', draft }))
  await f.service.executeAdjustment(command(await f.service.adjustmentForm(query, { target: { adjustmentId: saved.adjustmentId! } }), 'continue-confirm', { kind: 'confirm-adjustment' }))
  expect((await f.service.adjustmentDetail(query, saved.adjustmentId!)).balance.remainingDelta.value).toBe(-160)
  const reversalTarget = { kind: 'recording-reversal' as const, draftKey: 'reverse-imported', original: { kind: 'actual-event' as const, eventId: f.eventId } }
  const reversal = { confirmedNotOccurred: true, confirmedOn: '2026-08-09', evidenceNote: '原退款实际未发生，迁入后双方核对' }
  const read = await f.service.actualReversalForm(query, { target: reversalTarget, draft: reversal })
  expect(read.eligibility.canConfirmReversal).toBe(true)
  const result = await f.service.executeAdjustment({ commandId: 'reverse-imported-confirm', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: f.projectId, target: reversalTarget, action: { kind: 'confirm-recording-reversal', reversal } })
  expect((await f.service.actualPaymentDetail(query, result.actualEventId!)).fact.signedAmount.value).toBe(40)
  expect((await f.service.actualLedger(query, { projectId: f.projectId })).netAmount.value).toBe(1000)
  expect((await f.service.adjustmentDetail(query, saved.adjustmentId!)).balance.remainingDelta.value).toBe(-200)
})
