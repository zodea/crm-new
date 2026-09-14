import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAttendanceCommand, PayrollAttendanceCommandResult, PayrollAttendanceMatrixRead, PayrollAttendanceScope } from '../../app/lib/payroll/central-attendance-contract'
import type { PayrollC1Context } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollQuery } from '../../app/lib/payroll/central-contract'
import type { PayrollIdentitySource, PayrollRun, PayrollServiceOptions } from './payroll-service'
import { createHash } from 'node:crypto'
import { decodePayrollAttendanceResult, encodePayrollAttendanceWire, parsePayrollAttendanceCommand, parsePayrollAttendanceScope } from '../../app/lib/payroll/central-attendance-codec'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { loadPayrollSourceExclusions } from '../../app/lib/payroll/central-source-locks'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { loadPayrollAttendanceFacts } from './payroll-attendance-facts'
import { loadPayrollC1Options, payrollC1WorkerNavigation } from './payroll-c1-options'

const hash = (v: unknown) => createHash('sha256').update(payrollCanonical(v)).digest('hex')
export async function markPayrollC1Recheck(db: TransactionDb, projectId: string, month: string, workerIds: string[], actor: string, onwards = false) {
  const heads = await db.select<{ id: string, leader_worker_id: string }>(`SELECT id,leader_worker_id FROM wage_statements WHERE project_id=? AND month${onwards ? '>=' : '='}? AND format_family='C1' AND status='checked' AND deleted_at IS NULL`, [projectId, month])
  for (const head of heads) {
    const members = await db.select<{ worker_id: string }>('SELECT worker_id FROM wage_statement_members WHERE statement_id=? AND deleted_at IS NULL', [head.id])
    if (workerIds.includes(head.leader_worker_id) || members.some(m => workerIds.includes(m.worker_id)))
      await payrollWriteRow(db, 'wage_statements', head.id, { needs_recheck: 1, updated_at: new Date().toISOString() }, actor)
  }
}
export function createPayrollAttendanceService(run: PayrollRun, options: PayrollServiceOptions) {
  async function matrix(db: TransactionDb, base: PayrollC1Context, source: PayrollIdentitySource, scope: PayrollAttendanceScope): Promise<PayrollAttendanceMatrixRead> {
    parsePayrollAttendanceScope(scope)
    if (scope.projectId && !source.projects.some(p => p.id === scope.projectId)) {
      const historical = await db.select('SELECT id FROM attendance_records WHERE project_id=? UNION SELECT entity_id FROM payroll_migration_evidence WHERE project_id=?', [scope.projectId, scope.projectId])
      if (!historical.length)
        throw payrollProblem('not-found', '考勤项目不存在，请核对原项目')
    }
    const catalog = await loadPayrollC1Options(db, source, base, scope.projectId)
    if (!scope.projectId || !scope.month)
      return { context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+attendance:${hash({ scope, catalog })}` }, scope, options: { projects: catalog.projects, crews: catalog.crews }, workers: [], records: [], locks: [], diagnostics: [], evidence: [] }
    const facts = await (options.attendanceFacts ?? loadPayrollAttendanceFacts)(db, scope)
    const records = facts.rows.filter(row => row.deletedAt === null && (scope.crewId === null || row.crewId === scope.crewId))
    const diagnostics = [...facts.diagnostics]
    for (const record of records) {
      const current = source.workers.find(w => w.id === record.workerId)
      if (current && current.crewId !== record.crewId)
        diagnostics.push({ code: 'original-crew-changed', message: '原同日考勤属于转组前班组，保留原记录与原班组，不能从当前班组覆盖', recordId: record.id, workerId: record.workerId, field: 'crewId', tableName: 'attendance_records', entityId: null, legacyRecordId: null })
    }
    const workers = catalog.workers.filter(w => scope.crewId === null || w.crewId === scope.crewId).map(w => ({ ...w, reasons: [...w.reasons] }))
    for (const record of records) {
      if (!workers.some(w => w.id === record.workerId)) {
        const current = source.workers.find(w => w.id === record.workerId)
        workers.push({ id: record.workerId, name: current?.name ?? null, crewId: record.crewId, eligible: false, reasons: ['原考勤仍保留；当前工人、项目或原班组资格已变化'], historical: true, source: current ? payrollC1WorkerNavigation(base, scope.projectId, current.id, current.name) : null })
      }
    }
    const locks = await loadPayrollSourceExclusions(db, { projectId: scope.projectId, month: scope.month, workerIds: workers.map(w => w.id), formatFamily: 'C1', statementId: null })
    for (const worker of workers) {
      if (locks.some(lock => lock.workerId === worker.id)) {
        worker.eligible = false
        worker.reasons.push('该人员当月已有签工链或已发工资，考勤不可再改')
      }
    }
    return { context: { ...base, readonly: !base.capabilities.includes('payroll:write'), sourceVersion: `${base.sourceVersion}+attendance:${hash({ scope, facts, workers, locks })}` }, scope, options: { projects: catalog.projects, crews: catalog.crews }, workers, records, locks, diagnostics, evidence: facts.evidence }
  }
  return {
    attendanceMatrix: (query: PayrollQuery, scope: PayrollAttendanceScope, sessionId?: string | null) => run(query, sessionId, (db, context, source) => matrix(db, context, source, scope)),
    async executeAttendance(input: PayrollAttendanceCommand, sessionId?: string | null): Promise<PayrollAttendanceCommandResult> {
      const command = parsePayrollAttendanceCommand(encodePayrollAttendanceWire(input))
      let absent = false
      try {
        return await run({ origin: command.origin }, sessionId, async (db, context, source) => {
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
            throw payrollProblem('forbidden', '考勤提交身份或工作区已变化')
          const fingerprint = hash(command)
          const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.fingerprint !== fingerprint || receipt.actor_id !== command.actorId)
              throw payrollProblem('conflict', '同一考勤提交编号不能换用其他内容')
            return decodePayrollAttendanceResult(JSON.parse(receipt.result_json), command)
          }
          absent = true
          const read = await matrix(db, context, source, command.scope)
          if (read.context.sourceVersion !== command.sourceVersion)
            throw payrollProblem('stale-source', '考勤来源已变化，请保留输入重新读取')
          const record = command.action.record
          const worker = read.workers.find(w => w.id === record.workerId)
          const current = source.workers.find(w => w.id === record.workerId)
          if (!worker?.eligible || !current || !source.projects.some(p => p.id === command.projectId) || (record.crewId !== null && record.crewId !== current.crewId) || (command.scope.crewId !== null && command.scope.crewId !== current.crewId))
            throw payrollProblem('relationship-mismatch', worker?.reasons[0] ?? '考勤工人不属于当前项目与班组')
          const old = await db.select<{ id: string, crew_id: string | null }>('SELECT id,crew_id FROM attendance_records WHERE project_id=? AND worker_id=? AND work_date=? AND deleted_at IS NULL', [command.projectId, record.workerId, record.workDate])
          if (old.length > 1)
            throw payrollProblem('conflict', '原同日考勤存在重复记录，请先核对原来源')
          if (old[0] && old[0].crew_id !== current.crewId)
            throw payrollProblem('relationship-mismatch', '原同日考勤属于转组前班组，原记录保留；不能以当前班组覆盖')
          const recordId = old[0]?.id ?? generateId('attendance')
          const logIds = [await payrollWriteRow(db, 'attendance_records', recordId, { project_id: command.projectId, worker_id: record.workerId, crew_id: old[0]?.crew_id ?? current.crewId, work_date: record.workDate, hours: record.hours, overtime_hours: record.overtimeHours, work_content: record.workContent, note: record.note, updated_at: new Date().toISOString() }, context.actorId)]
          await markPayrollC1Recheck(db, command.projectId, command.scope.month, [record.workerId], context.actorId)
          await advancePayrollRevision(db)
          const result: PayrollAttendanceCommandResult = { commandId: command.commandId, projectId: command.projectId, recordId, workerId: record.workerId, workDate: record.workDate, sourceVersion: `payroll:${await payrollRevision(db)}`, outcome: 'saved', logIds }
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
