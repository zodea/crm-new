import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollC2Blocker, PayrollC2Command, PayrollC2CommandResult, PayrollC2ConfigRead, PayrollC2ConfigScope, PayrollC2Draft, PayrollC2FormInput, PayrollC2FormRead, PayrollC2OutputRead, PayrollC2StatementSourceVersioned } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollJson, PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollIdentitySource, PayrollRun, PayrollServiceOptions } from './payroll-service'
import { createHash } from 'node:crypto'
import { payrollC2Amount, payrollC2Lines } from '../../app/lib/payroll/central-c2-calculation'
import { decodePayrollC2Result, encodePayrollC2Wire, isPayrollC2StatementSourceVersioned, parsePayrollC2Command, parsePayrollC2ConfigScope, parsePayrollC2FormInput } from '../../app/lib/payroll/central-c2-codec'
import { payrollC2Source, persistPayrollC2, releasePayrollC2 } from '../../app/lib/payroll/central-c2-command'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollHollowFrozenReadWithCurrent } from '../../app/lib/payroll/central-hollow-deduction-read'
import { payrollHollowAllowsZeroRelease } from '../../app/lib/payroll/central-hollow-deduction-release'
import { wireMonth } from '../../app/lib/payroll/central-payroll-wire'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { loadPayrollSourceExclusions } from '../../app/lib/payroll/central-source-locks'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollC2ReleasedWithMigration } from './payroll-c-released-with-migration'
import { loadPayrollC2ConfigFacts, loadPayrollDayworkFacts } from './payroll-daywork-facts'
import { markPayrollC2Recheck, projectPayrollDayworkRecords } from './payroll-daywork-service'
import { readPayrollHollowCurrentForSnapshot, readPayrollHollowInTransaction } from './payroll-hollow-read'
import { payrollMigratedC2Form } from './payroll-migrated-form'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'
import { loadPayrollParticipantOptions } from './payroll-participant-options'
import { persistPayrollReleaseAdjustments, preparePayrollReleaseAdjustments } from './payroll-release-adjustments'

const hash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
type Row = Record<string, unknown>
const block = (code: string, message: string, fields: Partial<PayrollC2Blocker> = {}): PayrollC2Blocker => ({ code, message, field: null, workerId: null, recordId: null, statementId: null, source: null, ...fields })
async function head(db: TransactionDb, id: string) {
  const [row] = await db.select<Row>('SELECT * FROM wage_statements WHERE id=?', [id])
  if (!row)
    throw payrollProblem('not-found', 'C2 原工资单不存在')
  if (row.format_family !== 'C2')
    throw payrollProblem('relationship-mismatch', '原单据不是 C2 工资，不能通过页面参数更改格式')
  return row
}
function sourceVersion(read: PayrollC2FormRead, locks: unknown) {
  const source = read.config ? payrollC2Source(read) : { draft: read.draft, facts: read.facts, config: null, qualificationVersion: read.qualificationVersion }
  const occupations = read.facts.flatMap(f => f.occupations.filter(o => o.statementId !== read.statementId))
  return { source, locks: { locks, occupations }, version: hash({ source, locks, occupations }) }
}
export function createPayrollC2Service(run: PayrollRun, options: PayrollServiceOptions) {
  async function form(db: TransactionDb, base: PayrollWritableContext, source: PayrollIdentitySource, input: PayrollC2FormInput): Promise<PayrollC2FormRead> {
    const row = input.statementId ? await head(db, input.statementId) : null
    if (base.sourceVersion === 'payroll-consumption-v1')
      base = { ...base, sourceVersion: `${base.sourceVersion}+head:${hash(row)}` }
    if (row?.status === 'released') {
      const migrated = payrollMigratedC2Form(await loadPayrollMigratedProof(db, String(row.project_id)), base, String(row.id))
      if (migrated) {
        if (migrated.hollow?.snapshot) {
          const current = await readPayrollHollowCurrentForSnapshot(db, base, source, String(row.id), migrated.hollow.snapshot, migrated.draft.memberWorkerIds ?? [], options)
          migrated.hollow = payrollHollowFrozenReadWithCurrent(base, String(row.id), migrated.hollow.snapshot, current)
        }
        return migrated
      }
    }
    let storedSource: PayrollC2StatementSourceVersioned | null = null
    let stored: Partial<PayrollC2Draft> = {}
    if (row) {
      const [saved] = await db.select<{ source_json: string }>('SELECT source_json FROM payroll_c2_statement_sources WHERE statement_id=?', [row.id])
      if (saved) {
        try {
          const original: unknown = JSON.parse(saved.source_json)
          if (isPayrollC2StatementSourceVersioned(original))
            storedSource = original
        }
        catch { /* 缺损源只保留原历史，不以当前配置重构。 */ }
      }
      stored = storedSource ? { ...storedSource.subject, month: storedSource.month, note: String(row.note ?? '') } : { projectId: String(row.project_id), crewId: row.crew_id === null ? null : String(row.crew_id), leaderWorkerId: String(row.leader_worker_id), month: String(row.month), memberWorkerIds: [], note: String(row.note ?? '') }
    }
    const draft: Partial<PayrollC2Draft> = { ...stored, ...input.draft }
    const projectId = draft.projectId ?? ''
    const month = draft.month ?? ''
    const ids = draft.memberWorkerIds ?? []
    const catalog = await loadPayrollParticipantOptions(db, source, base, projectId)
    const members = ids.map(id => catalog.workers.find(w => w.id === id) ?? { id, name: source.workers.find(w => w.id === id)?.name ?? null, crewId: source.workers.find(w => w.id === id)?.crewId ?? null, eligible: false, reasons: ['工资成员当前项目或班组资格不可用'], historical: true, source: null })
    const all = projectId && wireMonth(month) ? await (options.dayworkFacts ?? loadPayrollDayworkFacts)(db, { projectId, month }) : { sourceVersion: '', rows: [], occupations: [], diagnostics: [], evidence: [] }
    const facts = (await projectPayrollDayworkRecords(db, base, source, all, catalog, month, input.statementId)).filter(f => ids.includes(f.workerId) && f.deletedAt === null)
    const configRead = await config(db, base, source, { projectId, leaderWorkerId: draft.leaderWorkerId ?? '' })
    const current = configRead.config
    const blockers: PayrollC2Blocker[] = []
    if (!source.projects.some(p => p.id === projectId))
      blockers.push(block('project-unavailable', '请选择当前可用工资项目', { field: 'projectId' }))
    if (!wireMonth(month))
      blockers.push(block('month-invalid', '请选择有效工资月份', { field: 'month' }))
    if (!draft.leaderWorkerId || !ids.length || !ids.includes(draft.leaderWorkerId) || new Set(ids).size !== ids.length)
      blockers.push(block('members-invalid', '请选择负责人及包含负责人的完整成员', { field: 'memberWorkerIds' }))
    for (const member of members) {
      if (!member.eligible || member.crewId !== draft.crewId)
        blockers.push(block('worker-unavailable', '工资成员须具有该项目与实际同班组资格', { workerId: member.id, field: 'memberWorkerIds', source: member.source }))
    }
    if (!current)
      blockers.push(block('config-missing', '该项目负责人尚无唯一有效 C2 主体配置', { field: 'config' }))
    else if (current.enabled !== true || current.deletedAt !== null || current.unitRate === null || current.unitRate <= 0 || current.ruleText === null || current.crewId !== draft.crewId || configRead.readonlyReasons.some(r => !r.includes('当前身份')))
      blockers.push(block('config-invalid', '主体配置的价格、规则、启用状态或真实班组不可用于核算', { field: 'config' }))
    for (const fact of facts.filter(f => f.availability === 'invalid')) blockers.push(block('daywork-invalid', fact.diagnostics[0]?.message ?? '原签工确认事实或资格不可确认', { recordId: fact.id, workerId: fact.workerId, source: fact.source }))
    for (const diagnostic of all.diagnostics) {
      if (diagnostic.recordId === null && (diagnostic.workerId === null || ids.includes(diagnostic.workerId)))
        blockers.push(block(diagnostic.code, diagnostic.message, { recordId: diagnostic.recordId, workerId: diagnostic.workerId, field: diagnostic.field }))
    }
    const adoptedRecordIds = facts.filter(f => f.availability === 'available').map(f => f.id).sort()
    if (!adoptedRecordIds.length)
      blockers.push(block('daywork-unavailable', facts.some(f => f.availability === 'occupied') ? '原签工已被其他工资领用，当前没有可用来源' : facts.some(f => f.availability === 'pending') ? '所选成员只有待确认签工，请先完成人工确认' : '所选成员当月没有已确认可用签工，不能生成空工资'))
    const locks = projectId && wireMonth(month) ? await loadPayrollSourceExclusions(db, { projectId, month, workerIds: ids, formatFamily: 'C2', statementId: input.statementId }) : []
    for (const lock of locks) blockers.push(block('source-occupied', '成员当月已有考勤链或已发工资，不能另计 C2', { workerId: lock.workerId, recordId: lock.attendanceRecordId ?? lock.dayworkRecordId, statementId: lock.statementId }))
    if (row && (!storedSource || row.deleted_at !== null))
      blockers.push(block('historical-readonly', '旧 C2 缺少完整中央逐签工来源或已归档，只保留原文阅读'))
    const lines = payrollC2Lines(facts.filter(f => adoptedRecordIds.includes(f.id)), current, members.map(m => ({ workerId: m.id, workerName: m.name })))
    let grossAmount = payrollC2Amount(lines, blockers.filter(b => !['source-occupied', 'historical-readonly'].includes(b.code)).map(b => b.message))
    const assignments = projectId ? await db.select<Row>('SELECT a.* FROM unit_assignments a JOIN units u ON u.id=a.unit_id JOIN floors f ON f.id=u.floor_id JOIN buildings b ON b.id=f.building_id WHERE b.project_id=? ORDER BY a.id', [projectId]) : []
    const qualificationVersion = hash({ project: source.projects.find(p => p.id === projectId) ?? null, crews: source.crews.filter(c => c.id === draft.crewId), workers: source.workers.filter(w => ids.includes(w.id)), assignments: assignments.filter(a => ids.includes(String(a.worker_id)) || (a.crew_id !== null && a.crew_id === draft.crewId)), members })
    const status = row ? row.status : 'new'
    if (!['new', 'draft', 'checked', 'released'].includes(String(status)))
      throw payrollProblem('conflict', '旧 C2 状态无法确认，请在原历史详情阅读')
    const read: PayrollC2FormRead = { context: { ...base, readonly: !base.capabilities.includes('payroll:write') }, statementId: input.statementId, draftKey: input.statementId ? null : input.draftKey!, status: status as PayrollC2FormRead['status'], needsRecheck: false, draft, options: catalog, members, facts, adoptedRecordIds, qualificationVersion, config: current, storedSource, sources: facts.flatMap(f => f.source ? [f.source] : []), lines, totals: { grossAmount }, blockers, eligibility: { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: false, reasons: [] }, diagnostics: [...all.diagnostics, ...configRead.diagnostics], evidence: [...all.evidence, ...configRead.evidence] }
    if (options.hollowFacts && (read.status !== 'released' || storedSource?.schemaVersion === 2)) {
      read.hollow = await readPayrollHollowInTransaction(db, base, source, { target: input.statementId ? { statementId: input.statementId, draftKey: null } : { statementId: null, draftKey: input.draftKey! }, scope: projectId && draft.leaderWorkerId ? { projectId, crewId: draft.crewId ?? null, leaderWorkerId: draft.leaderWorkerId, formatFamily: 'C2', book: null } : null, month: wireMonth(month) ? month : null, memberWorkerIds: ids, claimSubtotal: grossAmount, status: read.status }, options)
      grossAmount = read.hollow.totals.grossAmount
      read.totals.grossAmount = grossAmount
      for (const reason of read.hollow.reasons)
        blockers.push(block('hollow-unavailable', reason))
    }
    const currentVersion = sourceVersion(read, locks)
    read.needsRecheck = read.status === 'checked' && (row?.needs_recheck === 1 || row?.checked_source_version !== currentVersion.version)
    read.context.sourceVersion = `${base.sourceVersion}+c2:${hash(currentVersion.source)}+locks:${hash(currentVersion.locks)}`
    const writable = base.capabilities.includes('payroll:write') && read.status !== 'released' && !blockers.length && grossAmount.value !== null
    read.eligibility = { canSaveDraft: writable, canCheck: writable && read.statementId !== null, canRelease: writable && read.status === 'checked' && !read.needsRecheck && (grossAmount.value! > 0 || payrollHollowAllowsZeroRelease(read.hollow?.snapshot)), canOutput: false, reasons: blockers.map(b => b.message) }
    if (read.status === 'released') {
      const document = (await loadPayrollC2ReleasedWithMigration(db, read.statementId!)).get(read.statementId!)
      if (document && storedSource) {
        if (document.hollow) {
          const currentHollow = read.hollow ?? await readPayrollHollowCurrentForSnapshot(db, base, source, document.id, document.hollow, draft.memberWorkerIds ?? [], options)
          read.hollow = payrollHollowFrozenReadWithCurrent(base, document.id, document.hollow, currentHollow)
        }
        read.members = document.members.map(m => ({ id: m.workerId, name: m.workerName, crewId: document.crewId, eligible: false, reasons: ['已发工资保留原成员事实'], historical: true, source: null }))
        read.facts = document.daywork.map(f => ({ ...f, workerName: document.members.find(m => m.workerId === f.workerId)?.workerName ?? null, crewName: document.crewName, source: { kind: 'source-record', subject: { state: 'resolved', entity: 'daywork', id: f.id, label: `${f.workDate} 签工`, no: null }, variant: 'ledger', view: null, filters: { dataOrigin: base.origin, projectId: f.projectId, month: document.month, crewId: f.crewId, workerId: f.workerId, workDate: f.workDate } }, occupations: [], locks: [], diagnostics: [], eligibility: { canEdit: false, canConfirm: false, reasons: ['已发签工不可修改；后续更正需引用原发放'] }, availability: 'occupied' }))
        read.sources = read.facts.flatMap(f => f.source ? [f.source] : [])
        read.config = document.config
        read.lines = document.lines
        read.adoptedRecordIds = document.daywork.map(f => f.id)
        read.qualificationVersion = storedSource.qualificationVersion
        read.totals.grossAmount = { value: document.grossAmount, knownValue: document.grossAmount, state: 'known', reasons: [] }
        read.blockers = []
        read.diagnostics = []
        read.eligibility = { canSaveDraft: false, canCheck: false, canRelease: false, canOutput: true, reasons: ['已发工资只能阅读当时冻结事实'] }
      }
      else if (!read.blockers.some(b => b.code === 'historical-readonly')) {
        read.blockers.push(block('historical-readonly', '原发放来源、冻结或成功回执不能相互核实，继续保留历史原文'))
        read.eligibility.reasons = read.blockers.map(b => b.message)
      }
    }
    return read
  }
  async function config(db: TransactionDb, base: PayrollWritableContext, source: PayrollIdentitySource, scope: PayrollC2ConfigScope): Promise<PayrollC2ConfigRead> {
    parsePayrollC2ConfigScope(scope)
    const catalog = await loadPayrollParticipantOptions(db, source, base, scope.projectId)
    const facts = scope.projectId && scope.leaderWorkerId ? await (options.c2ConfigFacts ?? loadPayrollC2ConfigFacts)(db, scope) : { sourceVersion: '', rows: [], diagnostics: [], evidence: [] }
    const active = facts.rows.filter(c => c.deletedAt === null && c.formatFamily === 'C2')
    const current = active.length === 1 ? active[0]! : null
    const leader = catalog.workers.find(w => w.id === scope.leaderWorkerId)
    const readonlyReasons = [...(base.capabilities.includes('payroll:write') ? [] : ['当前身份只能阅读 C2 主体配置']), ...(source.projects.some(p => p.id === scope.projectId) ? [] : ['请选择当前可用项目']), ...(leader?.eligible ? [] : ['请选择该项目的真实负责人']), ...(active.length > 1 ? ['同一主体存在多份有效配置，请先核对原资料'] : [])]
    const parsed = (raw: unknown): PayrollJson | null => {
      if (typeof raw !== 'string')
        return null
      try {
        return JSON.parse(raw) as PayrollJson
      }
      catch { return null }
    }
    const logs = await db.select<Row>('SELECT * FROM operation_logs WHERE table_name=\'payroll_subject_configs\' ORDER BY created_at,id')
    const history = logs.filter(l => facts.rows.some(c => c.id === l.record_id)).map(l => ({ id: String(l.id), tableName: String(l.table_name), recordId: String(l.record_id), operation: String(l.action), operatedAt: typeof l.created_at === 'string' ? l.created_at : null, operator: typeof l.operator === 'string' ? l.operator : null, beforeData: parsed(l.before_data), afterData: parsed(l.after_data), beforeRaw: typeof l.before_data === 'string' ? l.before_data : null, afterRaw: typeof l.after_data === 'string' ? l.after_data : null }))
    return { context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+c2-config:${hash({ scope, facts, leader, readonlyReasons })}` }, scope, options: catalog, config: current, configs: facts.rows, draft: { crewId: current?.crewId ?? leader?.crewId ?? null, unitRate: current?.unitRate ?? null, ruleText: current ? current.ruleText : '' }, diagnostics: facts.diagnostics, evidence: facts.evidence, readonlyReasons, history }
  }
  return {
    c2FormInTransaction: form,
    c2Form: (query: PayrollQuery, input: PayrollC2FormInput, sessionId?: string | null) => run(query, sessionId, (db, context, source) => form(db, context, source, parsePayrollC2FormInput(encodePayrollC2Wire(input)))),
    c2Config: (query: PayrollQuery, scope: PayrollC2ConfigScope, sessionId?: string | null) => run(query, sessionId, (db, context, source) => config(db, context, source, scope)),
    c2Output: (query: PayrollQuery, statementId: string, sessionId?: string | null): Promise<PayrollC2OutputRead> => run(query, sessionId, async (db, base) => {
      const row = await head(db, statementId)
      if (query.projectId && query.projectId !== row.project_id)
        throw payrollProblem('relationship-mismatch', 'C2 输出与原项目不一致')
      const context = { ...base, readonly: !base.capabilities.includes('payroll:write') }
      const document = (await loadPayrollMigratedProof(db, String(row.project_id))).c2Documents.get(statementId) ?? (await loadPayrollC2ReleasedWithMigration(db, statementId)).get(statementId)
      return document ? { context, statementId, state: 'available', document, reasons: [] } : { context, statementId, state: 'unavailable', document: null, reasons: ['这份工资缺少可相互核实的原签工、主体配置、冻结与原成功回执；保留原历史阅读'] }
    }),
    async executeC2(input: PayrollC2Command, sessionId?: string | null): Promise<PayrollC2CommandResult> {
      const command = parsePayrollC2Command(encodePayrollC2Wire(input))
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (db, context, source) => {
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
            throw payrollProblem('forbidden', 'C2 提交身份或工作区已变化')
          const fingerprint = hash(command)
          const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== command.actorId)
              throw payrollProblem('conflict', '同一 C2 提交编号不能换用其他正文')
            return decodePayrollC2Result(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const [start] = await db.select<{ value: number }>('SELECT COALESCE(MAX(rowid),0) AS value FROM operation_logs')
          const result: PayrollC2CommandResult = { commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, configId: '', dayworkRecordIds: [], dayworkLinkIds: [], sourceVersion: '', outcome: 'saved', logIds: [] }
          if (command.action.kind === 'save-c2-config') {
            const read = await config(db, context, source, command.configScope!)
            if (read.context.sourceVersion !== command.sourceVersion)
              throw payrollProblem('stale-source', '主体配置或资格已变化，请保留原输入重新读取')
            if (read.readonlyReasons.length || (read.config?.id ?? null) !== command.configId)
              throw payrollProblem('relationship-mismatch', read.readonlyReasons[0] ?? 'C2 原配置身份已变化')
            const input = command.action.config
            if (input.unitRate === null || !Number.isFinite(input.unitRate) || input.unitRate <= 0)
              throw payrollProblem('validation-failed', 'C2 大工单价必须是明确的正数', { unitRate: ['请填写大于 0 的大工单价'] })
            if (input.ruleText === null)
              throw payrollProblem('validation-failed', '请明确填写规则文字，确认不需要规则时可留空串', { ruleText: ['缺失规则不能按当前默认文字补齐'] })
            if (read.options.workers.find(w => w.id === read.scope.leaderWorkerId)?.crewId !== input.crewId)
              throw payrollProblem('relationship-mismatch', '主体配置必须保留负责人的真实班组')
            result.configId = read.config?.id ?? generateId('payroll-c2-config')
            await payrollWriteRow(db, 'payroll_subject_configs', result.configId, { project_id: command.projectId, crew_id: input.crewId, leader_worker_id: read.scope.leaderWorkerId, format_family: 'C2', unit_rate: input.unitRate, rule_text: input.ruleText, enabled: 1, updated_at: new Date().toISOString() }, context.actorId)
            await markPayrollC2Recheck(db, command.projectId, context.actorId, { leaderWorkerId: read.scope.leaderWorkerId })
          }
          else {
            const action = command.action
            const input: PayrollC2FormInput = command.statementId ? { statementId: command.statementId, ...(action.kind === 'save-c2-draft' ? { draft: action.draft } : {}) } : { statementId: null, draftKey: command.draftKey!, draft: action.kind === 'save-c2-draft' ? action.draft : {} }
            const read = await form(db, context, source, input)
            if (read.draft.projectId !== command.projectId)
              throw payrollProblem('relationship-mismatch', 'C2 工资与原提交项目不一致')
            if (read.status === 'released' || read.blockers.some(b => b.code === 'historical-readonly'))
              throw payrollProblem('conflict', '已发或来源缺损的历史 C2 只能阅读')
            if (!(action.kind === 'release-c2' && read.status === 'checked' && read.needsRecheck) && read.context.sourceVersion !== command.sourceVersion)
              throw payrollProblem('stale-source', 'C2 签工、配置、成员或占用已变化，请保留输入重新读取')
            if (action.kind === 'save-c2-draft' || action.kind === 'check-c2') {
              if (!(action.kind === 'save-c2-draft' ? read.eligibility.canSaveDraft : read.eligibility.canCheck))
                throw payrollProblem('validation-failed', read.blockers[0]?.message ?? '当前 C2 来源不能保存或核对')
              if ((await db.select('SELECT id FROM wage_statements WHERE project_id=? AND month=? AND leader_worker_id=? AND format_family=\'C2\' AND id<>? AND (deleted_at IS NULL OR status=\'released\')', [command.projectId, read.draft.month, read.draft.leaderWorkerId, command.statementId ?? ''])).length)
                throw payrollProblem('conflict', '该负责人当月已有 C2 工资，请继续原单')
              const locks = await loadPayrollSourceExclusions(db, { projectId: command.projectId, month: read.draft.month!, workerIds: read.draft.memberWorkerIds!, formatFamily: 'C2', statementId: command.statementId })
              result.statementId = command.statementId ?? generateId('wage')
              await persistPayrollC2(db, result.statementId, read, sourceVersion(read, locks).version, action.kind === 'check-c2' ? 'checked' : 'draft', context.actorId)
              result.outcome = action.kind === 'check-c2' ? 'checked' : 'saved'
              result.configId = read.config!.id
              const links = await db.select<{ id: string, daywork_record_id: string }>('SELECT id,daywork_record_id FROM wage_statement_daywork_records WHERE statement_id=? AND deleted_at IS NULL ORDER BY id', [result.statementId])
              result.dayworkRecordIds = links.map(l => l.daywork_record_id)
              result.dayworkLinkIds = links.map(l => l.id)
            }
            else {
              if (read.status === 'checked' && read.needsRecheck) {
                await payrollWriteRow(db, 'wage_statements', command.statementId!, { needs_recheck: 1, updated_at: new Date().toISOString() }, context.actorId)
                result.outcome = 'needs-recheck'
              }
              else {
                const locks = await loadPayrollSourceExclusions(db, { projectId: command.projectId, month: read.draft.month!, workerIds: read.draft.memberWorkerIds!, formatFamily: 'C2', statementId: command.statementId })
                const applications = await preparePayrollReleaseAdjustments(db, command.statementId!, action.release.actualAmount, action.release.adjustmentApplications)
                await releasePayrollC2(db, read, action.release, sourceVersion(read, locks).version, context.actorId, command.commandId)
                if (applications !== undefined)
                  result.adjustmentApplicationIds = await persistPayrollReleaseAdjustments(db, command.statementId!, command.commandId, applications, context.actorId)
                result.outcome = 'released'
              }
              result.configId = read.storedSource?.config.id ?? read.config?.id ?? ''
              const links = await db.select<{ id: string, daywork_record_id: string }>('SELECT id,daywork_record_id FROM wage_statement_daywork_records WHERE statement_id=? AND deleted_at IS NULL ORDER BY id', [command.statementId])
              result.dayworkRecordIds = links.map(l => l.daywork_record_id)
              result.dayworkLinkIds = links.map(l => l.id)
            }
          }
          await advancePayrollRevision(db)
          result.sourceVersion = `payroll:${await payrollRevision(db)}`
          result.logIds = (await db.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid>? ORDER BY rowid', [start?.value ?? 0])).map(r => r.id)
          decodePayrollC2Result(result, command)
          await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.projectId, result.statementId, command.configScope === null ? null : payrollCanonical(command.configScope), command.action.kind, fingerprint, JSON.stringify(result), payrollCanonical(command)])
          return result
        }, true, command)
      }
      catch (cause) {
        if (absent && cause instanceof ProjectRepositoryProblem)
          Object.assign(cause.problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
        throw cause
      }
    },
  }
}
