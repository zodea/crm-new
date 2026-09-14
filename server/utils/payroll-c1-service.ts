import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollC1Blocker, PayrollC1Command, PayrollC1CommandResult, PayrollC1ConfigRead, PayrollC1ConfigScope, PayrollC1Context, PayrollC1Draft, PayrollC1FormInput, PayrollC1FormRead, PayrollC1OutputRead, PayrollC1Rate } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollJson, PayrollQuery } from '../../app/lib/payroll/central-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import type { PayrollIdentitySource, PayrollRun, PayrollServiceOptions } from './payroll-service'
import { createHash } from 'node:crypto'
import { payrollC1Amount, payrollC1Lines } from '../../app/lib/payroll/central-c1-calculation'
import { decodePayrollC1Result, encodePayrollC1Wire, isPayrollC1Rate, isPayrollC1StatementSourceSnapshot, parsePayrollC1Command, parsePayrollC1ConfigScope, parsePayrollC1FormInput } from '../../app/lib/payroll/central-c1-codec'
import { payrollC1Source, persistPayrollC1, releasePayrollC1 } from '../../app/lib/payroll/central-c1-command'
import { loadPayrollC1ReleasedDocuments } from '../../app/lib/payroll/central-c1-provenance'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { wireMonth } from '../../app/lib/payroll/central-payroll-wire'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { loadPayrollSourceExclusions } from '../../app/lib/payroll/central-source-locks'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollAttendanceFacts } from './payroll-attendance-facts'
import { markPayrollC1Recheck } from './payroll-attendance-service'
import { loadPayrollC1Options } from './payroll-c1-options'
import { payrollMigratedC1Form } from './payroll-migrated-form'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { persistPayrollReleaseAdjustments, preparePayrollReleaseAdjustments } from './payroll-release-adjustments'

type Row = Record<string, unknown>
const hash = (v: unknown) => createHash('sha256').update(payrollCanonical(v)).digest('hex')
const block = (code: string, message: string, values: Partial<PayrollC1Blocker> = {}): PayrollC1Blocker => ({ code, message, field: null, workerId: null, recordId: null, statementId: null, source: null, ...values })
async function head(db: TransactionDb, id: string) {
  const [row] = await db.select<Row>('SELECT * FROM wage_statements WHERE id=?', [id])
  if (!row)
    throw payrollProblem('not-found', 'C1 工资单不存在')
  if (row.format_family !== 'C1')
    throw payrollProblem('relationship-mismatch', '该单据不是 C1 工资，不能更改其格式')
  return row
}
async function rates(db: TransactionDb, source: PayrollIdentitySource, projectId: string, month: string, workerIds: string[]): Promise<PayrollC1Rate[]> {
  const saved = await db.select<Row>('SELECT * FROM payroll_c1_rate_revisions WHERE project_id=? AND effective_month<=? ORDER BY effective_month DESC,revision DESC', [projectId, month])
  return workerIds.map((workerId) => {
    const worker = source.workers.find(w => w.id === workerId)
    const config = saved.find(r => r.worker_id === workerId)
    const profileDailyWage = worker?.dailyWageState === 'value' ? worker.dailyWage ?? null : null
    const configuredDailyWage = config?.daily_wage == null ? null : Number(config.daily_wage)
    const configuredOvertimeRate = config?.overtime_rate == null ? null : Number(config.overtime_rate)
    const dailyWage = profileDailyWage ?? configuredDailyWage
    const overtimeRate = configuredOvertimeRate ?? (dailyWage === null ? null : dailyWage / 8)
    return { workerId, workerName: worker?.name ?? null, profileDailyWage, configuredDailyWage, configuredOvertimeRate, dailyWage, dailyWageSource: profileDailyWage !== null ? 'worker-profile' : configuredDailyWage !== null ? 'payroll-config' : 'missing', overtimeRate, overtimeRateSource: configuredOvertimeRate !== null ? 'payroll-config' : dailyWage !== null ? 'daily-divided-eight' : 'missing', configId: config ? String(config.id) : null, revision: config ? Number(config.revision) : null, effectiveMonth: config ? String(config.effective_month) : null, sourceVersion: hash({ worker: worker ? { id: worker.id, name: worker.name, crewId: worker.crewId, currentProjectId: worker.currentProjectId ?? null, dailyWage: worker.dailyWage ?? null, dailyWageState: worker.dailyWageState ?? 'missing', sourceVersion: worker.sourceVersion ?? null } : null, config: config ?? null }) }
  })
}
export function createPayrollC1Service(run: PayrollRun, options: PayrollServiceOptions) {
  async function form(db: TransactionDb, base: PayrollC1Context, source: PayrollIdentitySource, input: PayrollC1FormInput): Promise<PayrollC1FormRead> {
    const row = input.statementId ? await head(db, input.statementId) : null
    if (row?.status === 'released') {
      const migrated = payrollMigratedC1Form(await loadPayrollMigratedProof(db, String(row.project_id)), base, String(row.id))
      if (migrated)
        return migrated
    }
    let stored: Partial<PayrollC1Draft> = {}
    let central = false
    if (row) {
      const [saved] = await db.select<{ source_json: string }>('SELECT source_json FROM payroll_c1_statement_sources WHERE statement_id=?', [row.id])
      if (saved) {
        try {
          const original: unknown = JSON.parse(saved.source_json)
          if (isPayrollC1StatementSourceSnapshot(original)) {
            stored = { ...original.subject, month: original.month, note: String(row.note ?? '') }
            central = true
          }
        }
        catch { /* 原文保留为历史诊断，不补造可维护来源。 */ }
      }
      if (!central)
        stored = { projectId: String(row.project_id), crewId: row.crew_id === null ? null : String(row.crew_id), leaderWorkerId: String(row.leader_worker_id), month: String(row.month), memberWorkerIds: [], note: String(row.note ?? '') }
    }
    const draft: Partial<PayrollC1Draft> = { ...stored, ...(input.draft ?? {}) }
    const projectId = draft.projectId ?? ''
    const month = draft.month ?? ''
    const memberIds = draft.memberWorkerIds ?? []
    const catalog = await loadPayrollC1Options(db, source, base, projectId)
    const members = memberIds.map(id => catalog.workers.find(w => w.id === id) ?? { id, name: source.workers.find(w => w.id === id)?.name ?? null, crewId: source.workers.find(w => w.id === id)?.crewId ?? null, eligible: false, reasons: ['工资成员当前不属于该项目或已失效'], historical: true, source: null })
    const all = projectId && wireMonth(month) ? await (options.attendanceFacts ?? loadPayrollAttendanceFacts)(db, { projectId, month }) : { sourceVersion: '', rows: [], diagnostics: [], evidence: [] }
    const facts = all.rows.filter(f => f.deletedAt === null && memberIds.includes(f.workerId))
    const effectiveRates = await rates(db, source, projectId, month, memberIds)
    const blockers: PayrollC1Blocker[] = []
    if (!source.projects.some(p => p.id === projectId))
      blockers.push(block('project-unavailable', '请选择当前可用项目', { field: 'projectId' }))
    if (!wireMonth(month))
      blockers.push(block('month-invalid', '请选择有效工资月份', { field: 'month' }))
    if (!draft.leaderWorkerId || !memberIds.includes(draft.leaderWorkerId) || !memberIds.length || new Set(memberIds).size !== memberIds.length)
      blockers.push(block('members-invalid', '请选择负责人和完整且不重复的成员', { field: 'memberWorkerIds' }))
    for (const member of members) {
      if (!member.eligible || member.crewId !== draft.crewId)
        blockers.push(block('worker-unavailable', '工资成员的当前项目或班组资格不可确认', { workerId: member.id, field: 'memberWorkerIds', source: member.source }))
    }
    if (!facts.length)
      blockers.push(block('attendance-missing', '所选成员当月没有真实考勤，不能生成空工资'))
    for (const diagnostic of all.diagnostics) {
      const original = diagnostic.recordId === null ? null : all.rows.find(f => f.id === diagnostic.recordId)
      if (diagnostic.workerId !== null && memberIds.includes(diagnostic.workerId) && (!original || original.deletedAt === null))
        blockers.push(block(diagnostic.code, diagnostic.message, { workerId: diagnostic.workerId, recordId: diagnostic.recordId, field: diagnostic.field }))
    }
    for (const fact of facts) {
      const worker = source.workers.find(w => w.id === fact.workerId)
      if (!worker || fact.crewId !== worker.crewId || fact.crewId !== draft.crewId)
        blockers.push(block('original-crew-changed', '原考勤班组与当前工资成员资格不同，保留原记录并先核对', { workerId: fact.workerId, recordId: fact.id }))
      if (fact.hours === null || fact.overtimeHours === null)
        blockers.push(block('attendance-hours-missing', '原考勤工时缺失，不能当作零核算', { workerId: fact.workerId, recordId: fact.id }))
    }
    for (const rate of effectiveRates) {
      if (!isPayrollC1Rate(rate) || rate.dailyWage === null || rate.overtimeRate === null)
        blockers.push(block('rate-missing', '该成员的个人工资标准未完整配置', { workerId: rate.workerId, field: 'rates' }))
    }
    const locks = wireMonth(month) ? await loadPayrollSourceExclusions(db, { projectId, month, workerIds: memberIds, formatFamily: 'C1', statementId: input.statementId }) : []
    for (const lock of locks) blockers.push(block('source-occupied', lock.formatFamily === 'C2' ? '该成员当月已有 C2 签工链，不能另计 C1 工资' : '该成员当月已有实发 C1 工资，不能再次计薪', { workerId: lock.workerId, recordId: lock.dayworkRecordId ?? lock.attendanceRecordId, statementId: lock.statementId }))
    if (row && (!central || row.deleted_at !== null))
      blockers.push(block('historical-readonly', '旧 C1 没有完整中央逐考勤来源或已归档，只保留原文阅读'))
    const lines = payrollC1Lines(facts, effectiveRates)
    const grossAmount = payrollC1Amount(lines, blockers.filter(b => !['source-occupied', 'historical-readonly'].includes(b.code)).map(b => b.message))
    const sources: NavigationIntentDTO[] = facts.map(f => ({ kind: 'source-record', subject: { state: 'resolved', entity: 'attendance', id: f.id, label: `${f.workDate} 考勤`, no: null }, variant: 'matrix', view: null, filters: { projectId, dataOrigin: base.origin, month, crewId: f.crewId, workerId: f.workerId, workDate: f.workDate, recordId: f.id } }))
    const status = row ? row.status as PayrollC1FormRead['status'] : 'new'
    const preliminary: PayrollC1FormRead = { context: { ...base, readonly: !base.capabilities.includes('payroll:write') }, statementId: input.statementId, draftKey: input.statementId ? null : input.draftKey!, status, needsRecheck: !!row?.needs_recheck, draft, options: catalog, members, facts, sources, rates: effectiveRates, lines, totals: { grossAmount }, blockers, eligibility: { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: false, reasons: blockers.map(b => b.message) } }
    const version = hash({ source: payrollC1Source(preliminary), locks })
    preliminary.context.sourceVersion = `${base.sourceVersion}+c1:${hash(payrollC1Source(preliminary))}+locks:${hash(locks)}`
    preliminary.needsRecheck ||= status === 'checked' && row?.checked_source_version !== version
    const writable = !preliminary.context.readonly && blockers.length === 0
    preliminary.eligibility = { canSaveDraft: writable && ['new', 'draft'].includes(status), canCheck: writable && ['draft', 'checked'].includes(status), canRelease: writable && status === 'checked' && !preliminary.needsRecheck && grossAmount.value !== null && grossAmount.value > 0, canOutput: false, reasons: blockers.map(b => b.message) }
    return preliminary
  }
  async function config(db: TransactionDb, base: PayrollC1Context, source: PayrollIdentitySource, scope: PayrollC1ConfigScope): Promise<PayrollC1ConfigRead> {
    parsePayrollC1ConfigScope(scope)
    const catalog = await loadPayrollC1Options(db, source, base, scope.projectId)
    catalog.workers = catalog.workers.filter(w => scope.crewId === null || w.crewId === scope.crewId)
    const values = await rates(db, source, scope.projectId, scope.month, catalog.workers.map(w => w.id))
    const locks = await loadPayrollSourceExclusions(db, { projectId: scope.projectId, month: scope.month, workerIds: catalog.workers.map(w => w.id), formatFamily: 'C1', statementId: null })
    for (const worker of catalog.workers) {
      if (locks.some(l => l.workerId === worker.id && l.kind === 'released-month')) {
        worker.eligible = false
        worker.reasons.push('该人员所选月份已发工资，原月标准只读')
      }
    }
    const readonlyReasons = !base.capabilities.includes('payroll:write') ? ['当前身份只能阅读个人工资标准'] : scope.projectId && !source.projects.some(p => p.id === scope.projectId) ? ['当前工资项目不可用'] : []
    const logs = await db.select<Row>('SELECT l.*,r.worker_id FROM operation_logs l JOIN payroll_c1_rate_revisions r ON r.id=l.record_id WHERE l.table_name=\'payroll_c1_rate_revisions\' AND r.project_id=? ORDER BY l.created_at,l.id', [scope.projectId])
    const parsed = (raw: unknown): PayrollJson | null => {
      if (typeof raw !== 'string')
        return null
      try {
        return JSON.parse(raw) as PayrollJson
      }
      catch { return null }
    }
    const history = logs.filter(row => catalog.workers.some(w => w.id === row.worker_id)).map(row => ({ id: String(row.id), tableName: String(row.table_name), recordId: String(row.record_id), operation: String(row.action), operatedAt: String(row.created_at), operator: row.operator === null ? null : String(row.operator), beforeData: parsed(row.before_data), afterData: parsed(row.after_data), beforeRaw: typeof row.before_data === 'string' ? row.before_data : null, afterRaw: typeof row.after_data === 'string' ? row.after_data : null }))
    return { context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+c1-config:${hash({ scope, values, workers: catalog.workers, locks })}` }, scope, options: catalog, rates: values, readonlyReasons, history }
  }
  return {
    c1Form: (query: PayrollQuery, input: PayrollC1FormInput, sessionId?: string | null) => run(query, sessionId, (db, context, source) => form(db, context, source, parsePayrollC1FormInput(encodePayrollC1Wire(input)))),
    c1Config: (query: PayrollQuery, scope: PayrollC1ConfigScope, sessionId?: string | null) => run(query, sessionId, (db, context, source) => config(db, context, source, scope)),
    c1Output: (query: PayrollQuery, statementId: string, sessionId?: string | null): Promise<PayrollC1OutputRead> => run(query, sessionId, async (db, base) => {
      const row = await head(db, statementId)
      if (query.projectId && query.projectId !== row.project_id)
        throw payrollProblem('relationship-mismatch', 'C1 输出与原项目不一致')
      const context = { ...base, readonly: !base.capabilities.includes('payroll:write') }
      const document = (await loadPayrollMigratedProof(db, String(row.project_id))).c1Documents.get(statementId) ?? (await loadPayrollC1ReleasedDocuments(db, statementId)).get(statementId)
      return document ? { context, statementId, state: 'available', document, reasons: [] } : { context, statementId, state: 'unavailable', document: null, reasons: ['这份历史工资缺少可相互证明的逐日考勤、个人费率、冻结与原发放回执；继续保留原文阅读'] }
    }),
    async executeC1(input: PayrollC1Command, sessionId?: string | null): Promise<PayrollC1CommandResult> {
      const command = parsePayrollC1Command(encodePayrollC1Wire(input))
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (db, context, source) => {
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
            throw payrollProblem('forbidden', 'C1 提交身份或工作区已变化')
          const fingerprint = hash(command)
          const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== command.actorId)
              throw payrollProblem('conflict', '同一 C1 提交编号不能改用其他内容')
            return decodePayrollC1Result(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const [start] = await db.select<{ value: number }>('SELECT COALESCE(MAX(rowid),0) AS value FROM operation_logs')
          const result: PayrollC1CommandResult = { commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, rateRevisionIds: [], sourceVersion: '', outcome: 'saved', logIds: [] }
          const action = command.action
          if (action.kind === 'save-c1-rates') {
            const read = await config(db, context, source, command.configScope!)
            if (read.context.sourceVersion !== command.sourceVersion)
              throw payrollProblem('stale-source', '个人工资标准或来源已变化，请保留输入重新读取')
            if (read.readonlyReasons.length || new Set(action.rates.map(r => r.workerId)).size !== action.rates.length)
              throw payrollProblem('validation-failed', '个人工资配置不可写或成员重复')
            for (const rate of action.rates) {
              if (!read.options.workers.some(w => w.id === rate.workerId && w.eligible))
                throw payrollProblem('relationship-mismatch', '个人标准所属工人不符合原项目、班组或月份资格')
              const [old] = await db.select<{ revision: number }>('SELECT MAX(revision) AS revision FROM payroll_c1_rate_revisions WHERE project_id=? AND worker_id=?', [command.projectId, rate.workerId])
              const id = generateId('payroll-c1-rate')
              await payrollWriteRow(db, 'payroll_c1_rate_revisions', id, { project_id: command.projectId, worker_id: rate.workerId, effective_month: command.configScope!.month, daily_wage: rate.dailyWage, overtime_rate: rate.overtimeRate, revision: (old?.revision ?? 0) + 1, operator_id: context.actorId, created_at: new Date().toISOString() }, context.actorId)
              result.rateRevisionIds.push(id)
            }
            await markPayrollC1Recheck(db, command.projectId, command.configScope!.month, action.rates.map(r => r.workerId), context.actorId, true)
          }
          else {
            const input: PayrollC1FormInput = command.statementId ? { statementId: command.statementId, ...(action.kind === 'save-c1-draft' ? { draft: action.draft } : {}) } : { statementId: null, draftKey: command.draftKey!, draft: action.kind === 'save-c1-draft' ? action.draft : {} }
            const read = await form(db, context, source, input)
            if (read.draft.projectId !== command.projectId)
              throw payrollProblem('relationship-mismatch', 'C1 工资与提交项目不一致')
            if (read.status === 'released' || read.blockers.some(b => b.code === 'historical-readonly'))
              throw payrollProblem('conflict', '已发或来源不完整的历史 C1 只可阅读')
            const locks = await loadPayrollSourceExclusions(db, { projectId: command.projectId, month: read.draft.month!, workerIds: read.draft.memberWorkerIds!, formatFamily: 'C1', statementId: command.statementId })
            const version = hash({ source: payrollC1Source(read), locks })
            if (action.kind === 'release-c1' && read.status === 'checked' && read.needsRecheck) {
              await payrollWriteRow(db, 'wage_statements', command.statementId!, { needs_recheck: 1, updated_at: new Date().toISOString() }, context.actorId)
              result.outcome = 'needs-recheck'
            }
            else {
              if (read.context.sourceVersion !== command.sourceVersion)
                throw payrollProblem('stale-source', 'C1 考勤、个人标准、成员或占用已变化，请保留输入重新读取')
              if (action.kind === 'save-c1-draft' || action.kind === 'check-c1') {
                if (!(action.kind === 'save-c1-draft' ? read.eligibility.canSaveDraft : read.eligibility.canCheck))
                  throw payrollProblem('validation-failed', read.blockers[0]?.message ?? '当前 C1 工资不能保存或核对')
                if ((await db.select('SELECT id FROM wage_statements WHERE project_id=? AND month=? AND leader_worker_id=? AND format_family=\'C1\' AND id<>? AND (deleted_at IS NULL OR status=\'released\')', [command.projectId, read.draft.month, read.draft.leaderWorkerId, command.statementId ?? ''])).length)
                  throw payrollProblem('conflict', '该负责人当月已有 C1 工资单，请继续原单')
                result.statementId = command.statementId ?? generateId('wage')
                await persistPayrollC1(db, result.statementId, read, version, action.kind === 'check-c1' ? 'checked' : 'draft', context.actorId)
                result.outcome = action.kind === 'check-c1' ? 'checked' : 'saved'
              }
              else {
                const applications = await preparePayrollReleaseAdjustments(db, command.statementId!, action.release.actualAmount, action.release.adjustmentApplications)
                await releasePayrollC1(db, read, action.release, version, context.actorId)
                if (applications !== undefined)
                  result.adjustmentApplicationIds = await persistPayrollReleaseAdjustments(db, command.statementId!, command.commandId, applications, context.actorId)
                result.outcome = 'released'
              }
            }
          }
          await advancePayrollRevision(db)
          result.sourceVersion = `payroll:${await payrollRevision(db)}`
          result.logIds = (await db.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid>? ORDER BY rowid', [start?.value ?? 0])).map(r => r.id)
          await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, result.statementId, command.configScope === null ? null : payrollCanonical(command.configScope), action.kind, fingerprint, JSON.stringify(result), payrollCanonical(command)])
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
