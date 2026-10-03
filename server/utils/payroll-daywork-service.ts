import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollParticipantOptions, PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollDayworkCommand, PayrollDayworkCommandResult, PayrollDayworkFact, PayrollDayworkFacts, PayrollDayworkFormInput, PayrollDayworkFormRead, PayrollDayworkListRead, PayrollDayworkRecordDraft, PayrollDayworkRecordRead, PayrollDayworkScope } from '../../app/lib/payroll/central-daywork-contract'
import type { PayrollStoredRow } from '../../app/lib/payroll/central-read'
import type { PayrollIdentitySource, PayrollRun, PayrollServiceOptions } from './payroll-service'
import { createHash } from 'node:crypto'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { decodePayrollDayworkResult, encodePayrollDayworkWire, parsePayrollDayworkCommand, parsePayrollDayworkFormInput, parsePayrollDayworkScope } from '../../app/lib/payroll/central-daywork-codec'
import { wireDate } from '../../app/lib/payroll/central-payroll-wire'
import { loadPayrollGraph } from '../../app/lib/payroll/central-read'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { loadPayrollSourceExclusions, payrollSourceExclusionsFromGraph } from '../../app/lib/payroll/central-source-locks'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollDayworkFacts, loadPayrollDayworkRecord } from './payroll-daywork-facts'
import { loadPayrollParticipantOptions } from './payroll-participant-options'

const hash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
const emptyDraft = (): PayrollDayworkRecordDraft => ({ projectId: '', crewId: null, workerId: '', workDate: '', workContent: '', startTime: '', endTime: '', laborUnits: null, witness: '', confirmedOn: null, status: 'draft', note: '' })
function draftFromFact(fact: PayrollDayworkFact): Partial<PayrollDayworkRecordDraft> {
  return { projectId: fact.projectId, crewId: fact.crewId, workerId: fact.workerId, workDate: fact.workDate, workContent: fact.workContent ?? '', startTime: fact.startTime ?? '', endTime: fact.endTime ?? '', laborUnits: fact.laborUnits, witness: fact.witness ?? '', confirmedOn: fact.confirmedOn, ...(fact.status === 'draft' || fact.status === 'confirmed' ? { status: fact.status } : {}), note: fact.note ?? '' }
}
export function validatePayrollDayworkRecord(record: PayrollDayworkRecordDraft) {
  const errors: Record<string, string[]> = {}
  if (!wireDate(record.workDate))
    errors.workDate = ['签工日期必须是真实日期']
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.startTime))
    errors.startTime = ['开始时间须为 HH:mm']
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.endTime) || record.endTime <= record.startTime)
    errors.endTime = ['结束时间须晚于开始时间，且在同一日']
  if (record.laborUnits !== 0.5 && record.laborUnits !== 1)
    errors.laborUnits = ['用工数只允许整工 1 或半工 0.5']
  if (!record.workContent.trim())
    errors.workContent = ['必须填写施工内容']
  if (record.status === 'confirmed' && !record.witness.trim())
    errors.witness = ['人工确认必须填写证明人']
  if ((record.status === 'confirmed' && !record.confirmedOn) || (record.confirmedOn !== null && (!wireDate(record.confirmedOn) || record.confirmedOn < record.workDate)))
    errors.confirmedOn = ['确认日期须为真实日期且不能早于签工日期']
  if (Object.keys(errors).length)
    throw payrollProblem('validation-failed', Object.values(errors)[0]![0]!, errors)
}
export async function markPayrollC2Recheck(db: TransactionDb, projectId: string, actor: string, target: { month?: string, workerIds?: string[], leaderWorkerId?: string, recordId?: string }) {
  const affected: string[] = []
  for (const head of await db.select<{ id: string, month: string, leader_worker_id: string }>('SELECT id,month,leader_worker_id FROM wage_statements WHERE format_family=\'C2\' AND status=\'checked\' AND deleted_at IS NULL')) {
    const [stored] = await db.select<{ project_id: string }>('SELECT project_id FROM wage_statements WHERE id=?', [head.id])
    const linked = target.recordId && (await db.select('SELECT id FROM wage_statement_daywork_records WHERE statement_id=? AND daywork_record_id=? AND deleted_at IS NULL', [head.id, target.recordId])).length > 0
    const members = await db.select<{ worker_id: string }>('SELECT worker_id FROM wage_statement_members WHERE statement_id=? AND deleted_at IS NULL', [head.id])
    const inScope = stored?.project_id === projectId && (!target.month || head.month === target.month) && (!target.leaderWorkerId || head.leader_worker_id === target.leaderWorkerId) && (!target.workerIds || target.workerIds.includes(head.leader_worker_id) || members.some(m => target.workerIds!.includes(m.worker_id)))
    if (linked || inScope) {
      await payrollWriteRow(db, 'wage_statements', head.id, { needs_recheck: 1, updated_at: new Date().toISOString() }, actor)
      affected.push(head.id)
    }
  }
  return affected
}
export async function projectPayrollDayworkRecords(db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, facts: PayrollDayworkFacts, catalog: PayrollParticipantOptions, month: string, statementId: string | null = null): Promise<PayrollDayworkRecordRead[]> {
  const projectId = facts.rows[0]?.projectId
  const locks = projectId ? await loadPayrollSourceExclusions(db, { projectId, month, workerIds: [...new Set(facts.rows.map(r => r.workerId))], formatFamily: 'C2', statementId }) : []
  return facts.rows.map((fact) => {
    const worker = catalog.workers.find(w => w.id === fact.workerId)
    const current = source.workers.find(w => w.id === fact.workerId)
    const diagnostics = facts.diagnostics.filter(d => d.recordId === fact.id || (d.recordId === null && d.workerId === fact.workerId))
    if (current && current.crewId !== fact.crewId)
      diagnostics.push({ code: 'daywork-original-crew-changed', message: '工人当前班组已变化，原签工仍保留原班组；请核对原关系', recordId: fact.id, workerId: fact.workerId, field: 'crewId', tableName: 'signed_daywork_records', entityId: null, legacyRecordId: null })
    const occupations = facts.occupations.filter(o => o.dayworkRecordId === fact.id)
    const recordLocks = locks.filter(l => l.workerId === fact.workerId)
    const released = recordLocks.some(l => l.kind === 'released-month') || occupations.some(o => o.status === 'released')
    const reasons = [...(context.capabilities.includes('payroll:write') ? [] : ['当前身份只能阅读签工']), ...(fact.deletedAt === null ? [] : ['原签工已删除，只能阅读原事实']), ...(worker?.eligible && worker.crewId === fact.crewId ? [] : ['原签工的项目、人员或班组资格不可用']), ...(recordLocks.length ? ['该人员月份已有考勤链或已发工资，原签工不可修改'] : []), ...(released ? ['这条签工已发工资，后续更正需引用原发放'] : [])]
    return { ...fact, workerName: current?.name ?? null, crewName: source.crews.find(c => c.id === fact.crewId)?.name ?? null, source: { kind: 'source-record', subject: { state: 'resolved', entity: 'daywork', id: fact.id, label: fact.workContent || fact.id, no: null }, variant: 'ledger', view: null, filters: { dataOrigin: context.origin, projectId: fact.projectId, month: fact.workDate.slice(0, 7), crewId: fact.crewId, workerId: fact.workerId, workDate: fact.workDate } }, occupations, locks: recordLocks, diagnostics, eligibility: { canEdit: reasons.length === 0, canConfirm: reasons.length === 0 && fact.status === 'draft', reasons }, availability: fact.deletedAt !== null ? 'deleted' : diagnostics.length || !worker?.eligible || worker.crewId !== fact.crewId ? 'invalid' : fact.status === 'draft' ? 'pending' : fact.status !== 'confirmed' ? 'invalid' : occupations.some(o => o.statementId !== statementId) ? 'occupied' : 'available' }
  })
}
export function createPayrollDayworkService(run: PayrollRun, options: PayrollServiceOptions) {
  async function list(db: TransactionDb, base: PayrollWritableContext, source: PayrollIdentitySource, scope: PayrollDayworkScope): Promise<PayrollDayworkListRead> {
    parsePayrollDayworkScope(scope)
    if (scope.projectId && !source.projects.some(project => project.id === scope.projectId)) {
      const historical = await db.select('SELECT id FROM signed_daywork_records WHERE project_id=? UNION SELECT entity_id FROM payroll_migration_evidence WHERE project_id=?', [scope.projectId, scope.projectId])
      if (!historical.length)
        throw payrollProblem('not-found', '签工项目不存在，请核对原项目')
    }
    const catalog = await loadPayrollParticipantOptions(db, source, base, scope.projectId)
    const facts = scope.projectId && scope.month ? await (options.dayworkFacts ?? loadPayrollDayworkFacts)(db, scope) : { sourceVersion: '', rows: [], occupations: [], diagnostics: [], evidence: [] }
    const records = (await projectPayrollDayworkRecords(db, base, source, facts, catalog, scope.month)).filter(r => (scope.crewId === null || r.crewId === scope.crewId) && (!scope.dayworkStatuses.length || ((r.status === 'draft' || r.status === 'confirmed') && scope.dayworkStatuses.includes(r.status))))
    // 月锁投影依据原工资全成员；台账筛选或当前名册不能抹去无签工成员。
    const locks = scope.projectId && scope.month
      ? payrollSourceExclusionsFromGraph({ ...await loadPayrollGraph(db), c2Sources: await db.select<PayrollStoredRow>('SELECT * FROM payroll_c2_statement_sources ORDER BY statement_id') }, { projectId: scope.projectId, month: scope.month, formatFamily: 'C2', statementId: null })
      : []
    return { context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+daywork-list:${hash({ scope, catalog, facts, records, locks })}` }, scope, options: catalog, records, locks, diagnostics: facts.diagnostics, evidence: facts.evidence }
  }
  async function form(db: TransactionDb, base: PayrollWritableContext, source: PayrollIdentitySource, input: PayrollDayworkFormInput): Promise<PayrollDayworkFormRead> {
    const original = input.recordId ? await (options.dayworkRecord ?? loadPayrollDayworkRecord)(db, input.recordId) : null
    if (input.recordId && !original?.record)
      throw payrollProblem('not-found', '原签工记录不存在，不能改为新增')
    const record = original?.record ?? null
    const draft = { ...(record ? draftFromFact(record) : emptyDraft()), ...input.draft }
    const catalog = await loadPayrollParticipantOptions(db, source, base, draft.projectId ?? '')
    const originalCatalog = record && record.projectId !== draft.projectId ? await loadPayrollParticipantOptions(db, source, base, record.projectId) : catalog
    const projected = record && original ? (await projectPayrollDayworkRecords(db, base, source, { ...original, rows: [record] }, originalCatalog, record.workDate.slice(0, 7)))[0]! : null
    const reasons = projected ? [...projected.eligibility.reasons] : base.capabilities.includes('payroll:write') ? [] : ['当前身份只能阅读签工']
    if (record && !['draft', 'confirmed'].includes(record.status ?? ''))
      reasons.push('原签工状态无法确认，保留历史原文阅读')
    return { context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+daywork-form:${hash({ record: projected, original })}` }, recordId: input.recordId, draftKey: input.recordId ? null : input.draftKey!, record: projected, draft, options: catalog, eligibility: { canEdit: !reasons.length, canConfirm: !reasons.length && record?.status === 'draft', reasons }, diagnostics: projected?.diagnostics ?? original?.diagnostics ?? [], evidence: original?.evidence ?? [] }
  }
  return {
    dayworkList: (query: PayrollQuery, scope: PayrollDayworkScope, sessionId?: string | null) => run(query, sessionId, (db, context, source) => list(db, context, source, scope)),
    dayworkForm: (query: PayrollQuery, input: PayrollDayworkFormInput, sessionId?: string | null) => run(query, sessionId, async (db, context, source) => {
      const read = await form(db, context, source, parsePayrollDayworkFormInput(encodePayrollDayworkWire(input)))
      if (read.record && ((query.projectId && read.record.projectId !== query.projectId) || (query.month && !read.record.workDate.startsWith(`${query.month}-`)) || (query.crewId && read.record.crewId !== query.crewId)))
        throw payrollProblem('relationship-mismatch', '原签工与指定关系不一致，请按原编号读取实际归属')
      return read
    }),
    async executeDaywork(input: PayrollDayworkCommand, sessionId?: string | null): Promise<PayrollDayworkCommandResult> {
      const command = parsePayrollDayworkCommand(encodePayrollDayworkWire(input))
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (db, context, source) => {
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
            throw payrollProblem('forbidden', '签工提交身份或工作区已变化')
          const fingerprint = hash(command)
          const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== command.actorId)
              throw payrollProblem('conflict', '同一签工提交编号不能换用其他正文')
            return decodePayrollDayworkResult(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const read = await form(db, context, source, command.recordId ? { recordId: command.recordId } : { recordId: null, draftKey: command.draftKey! })
          if (read.context.sourceVersion !== command.sourceVersion)
            throw payrollProblem('stale-source', '原签工、身份或占用已变化，请保留输入重新读取')
          if (!read.eligibility.canEdit)
            throw payrollProblem('conflict', read.eligibility.reasons[0] ?? '原签工不可修改')
          if (read.record && payrollCanonical(command.originalScope) !== payrollCanonical({ projectId: read.record.projectId, crewId: read.record.crewId, workerId: read.record.workerId, workDate: read.record.workDate }))
            throw payrollProblem('relationship-mismatch', '原签工目标与原范围不一致')
          const record = command.action.kind === 'save-daywork' ? command.action.record : { ...read.draft, ...command.action.confirmation, status: 'confirmed' as const } as PayrollDayworkRecordDraft
          if (command.action.kind === 'confirm-daywork' && read.record?.status !== 'draft')
            throw payrollProblem('conflict', '原签工已经确认，请通过原记录编辑核对')
          validatePayrollDayworkRecord(record)
          const catalog = await loadPayrollParticipantOptions(db, source, context, record.projectId)
          const worker = catalog.workers.find(w => w.id === record.workerId)
          if (!source.projects.some(p => p.id === record.projectId) || !worker?.eligible || worker.crewId !== record.crewId)
            throw payrollProblem('relationship-mismatch', '签工必须使用当前项目的真实人员和班组')
          const ranges = [record, ...(read.record ? [read.record] : [])]
          for (const range of ranges) {
            const locks = await loadPayrollSourceExclusions(db, { projectId: range.projectId, month: range.workDate.slice(0, 7), workerIds: [range.workerId], formatFamily: 'C2', statementId: null })
            if (locks.length)
              throw payrollProblem('conflict', '原或目标月份已有考勤链或已发工资，不能移动或修改签工')
          }
          const facts = await (options.dayworkFacts ?? loadPayrollDayworkFacts)(db, { projectId: record.projectId, month: record.workDate.slice(0, 7) })
          const sameDay = facts.rows.filter(r => r.id !== command.recordId && r.deletedAt === null && r.workerId === record.workerId && r.workDate === record.workDate)
          if (sameDay.some(r => r.laborUnits !== 0.5 && r.laborUnits !== 1) || sameDay.some(r => r.startTime === null || r.endTime === null || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.startTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.endTime) || r.startTime >= r.endTime))
            throw payrollProblem('conflict', '原同日签工有不可确认的时段或工数，不能据此新增')
          if (sameDay.some(r => r.startTime! < record.endTime && r.endTime! > record.startTime))
            throw payrollProblem('validation-failed', '同一人员同日签工时段重叠', { startTime: ['请核对同日其他记录'] })
          if (sameDay.reduce((sum, r) => sum + r.laborUnits!, record.laborUnits!) > 1)
            throw payrollProblem('validation-failed', '同一人员同日用工数不能超过 1 工', { laborUnits: ['待确认记录也计入日上限'] })
          const [start] = await db.select<{ value: number }>('SELECT COALESCE(MAX(rowid),0) AS value FROM operation_logs')
          const recordId = command.recordId ?? generateId('daywork')
          await payrollWriteRow(db, 'signed_daywork_records', recordId, { project_id: record.projectId, crew_id: record.crewId, worker_id: record.workerId, work_date: record.workDate, work_content: record.workContent, start_time: record.startTime, end_time: record.endTime, labor_units: record.laborUnits, witness: record.witness, confirmed_on: record.confirmedOn, status: record.status, note: record.note, updated_at: new Date().toISOString() }, context.actorId)
          const affectedStatementIds = new Set<string>()
          for (const range of ranges) {
            for (const id of await markPayrollC2Recheck(db, range.projectId, context.actorId, { month: range.workDate.slice(0, 7), workerIds: [range.workerId], recordId })) affectedStatementIds.add(id)
          }
          await advancePayrollRevision(db)
          const saved = await (options.dayworkRecord ?? loadPayrollDayworkRecord)(db, recordId)
          if (!saved.record)
            throw payrollProblem('unavailable', '保存后的签工原行无法确认')
          const result: PayrollDayworkCommandResult = { commandId: command.commandId, projectId: command.projectId, recordId, recordProjectId: record.projectId, workerId: record.workerId, workDate: record.workDate, status: record.status, affectedStatementIds: [...affectedStatementIds].sort(), recordFingerprint: saved.record.sourceFingerprint, sourceVersion: `payroll:${await payrollRevision(db)}`, outcome: command.action.kind === 'save-daywork' ? 'saved' : 'confirmed', logIds: (await db.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid>? ORDER BY rowid', [start?.value ?? 0])).map(r => r.id) }
          decodePayrollDayworkResult(result, command)
          await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,NULL,NULL,?,?,?,?)', [command.commandId, context.actorId, command.projectId, command.action.kind, fingerprint, JSON.stringify(result), payrollCanonical(command)])
          return result
        }, true)
      }
      catch (cause) {
        if (absent && cause instanceof ProjectRepositoryProblem)
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      }
    },
  }
}
