import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollARoundingCommand, PayrollARoundingCommandResult, PayrollARoundingRead, PayrollARoundingRevision, PayrollARoundingScope } from '../../app/lib/payroll/central-a-rounding-contract'
import type { PayrollQuery, PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollIdentitySource, PayrollRun } from './payroll-service'
import { createHash } from 'node:crypto'
import { parsePayrollARoundingCommand } from '../../app/lib/payroll/central-a-rounding-codec'
import { initializePayrollARoundingSchema } from '../../app/lib/payroll/central-a-rounding-schema'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { generateId } from '../../app/lib/util/id'

function hash(value: unknown): string {
  return createHash('sha256').update(payrollCanonical(value)).digest('hex')
}

function bookWhere(scope: PayrollARoundingScope): [string, string | null] {
  return [scope.book.bookPurpose, scope.book.managementBookId]
}

async function assertScope(db: TransactionDb, source: PayrollIdentitySource, scope: PayrollARoundingScope): Promise<string[]> {
  if (!source.projects.some(project => project.id === scope.projectId) || !source.workers.some(worker => worker.id === scope.leaderWorkerId))
    throw payrollProblem('relationship-mismatch', 'A 工资取整所属项目或负责人不可用')
  if (scope.book.bookPurpose === 'management') {
    const [book] = await db.select<{ project_id: string, manager_worker_id: string | null, deleted_at: string | null }>('SELECT project_id,manager_worker_id,deleted_at FROM payroll_a_management_books WHERE id=?', [scope.book.managementBookId])
    if (!book || book.project_id !== scope.projectId || book.manager_worker_id !== scope.leaderWorkerId || book.deleted_at !== null)
      throw payrollProblem('relationship-mismatch', '管理工资簿与当前项目或负责人不匹配')
  }
  const [purpose, managementBookId] = bookWhere(scope)
  const released = await db.select('SELECT w.id FROM wage_statements w LEFT JOIN payroll_a_statement_books b ON b.statement_id=w.id WHERE w.project_id=? AND w.leader_worker_id=? AND w.month=? AND w.format_family=\'A\' AND w.status=\'released\' AND COALESCE(b.book_purpose,\'ordinary\')=? AND COALESCE(b.management_book_id,\'\')=COALESCE(?,\'\')', [scope.projectId, scope.leaderWorkerId, scope.month, purpose, managementBookId])
  return released.length ? ['所选月份及请款簿已经发放，取整规则只可从后续未发月份起生效'] : []
}

async function revisions(db: TransactionDb, scope: PayrollARoundingScope): Promise<PayrollARoundingRevision[]> {
  const [purpose, managementBookId] = bookWhere(scope)
  const rows = await db.select<Record<string, unknown>>('SELECT * FROM payroll_a_rounding_revisions WHERE project_id=? AND leader_worker_id=? AND book_purpose=? AND COALESCE(management_book_id,\'\')=COALESCE(?,\'\') ORDER BY effective_month,revision,id', [scope.projectId, scope.leaderWorkerId, purpose, managementBookId])
  return rows.map((row) => {
    const rule = JSON.parse(String(row.rule_json)) as PayrollARoundingRevision['rule']
    const identity = { id: String(row.id), projectId: String(row.project_id), leaderWorkerId: String(row.leader_worker_id), book: { bookPurpose: String(row.book_purpose), managementBookId: row.management_book_id === null ? null : String(row.management_book_id) }, effectiveMonth: String(row.effective_month), revision: Number(row.revision), rule, operatorId: String(row.operator_id), createdAt: String(row.created_at) }
    return { ...identity, sourceVersion: hash(identity) } as PayrollARoundingRevision
  })
}

export function createPayrollARoundingService(run: PayrollRun) {
  async function read(db: TransactionDb, context: PayrollWritableContext, source: PayrollIdentitySource, scope: PayrollARoundingScope): Promise<PayrollARoundingRead> {
    await initializePayrollARoundingSchema(db)
    const readonlyReasons = await assertScope(db, source, scope)
    if (!context.capabilities.includes('payroll:write'))
      readonlyReasons.push('当前身份只能读取 A 工资取整配置')
    const all = await revisions(db, scope)
    const current = [...all].filter(row => row.effectiveMonth <= scope.month).sort((left, right) => right.effectiveMonth.localeCompare(left.effectiveMonth) || right.revision - left.revision || right.id.localeCompare(left.id))[0] ?? null
    return { context: { ...context, readonly: !context.capabilities.includes('payroll:write'), sourceVersion: `${context.sourceVersion}+a-rounding:${hash({ scope, all })}` }, scope, current, revisions: all, readonlyReasons }
  }

  return {
    aRoundingInTransaction: read,
    aRounding: (query: PayrollQuery, scope: PayrollARoundingScope, sessionId?: string | null) => run(query, sessionId, (db, context, source) => read(db, context, source, scope)),
    async executeARounding(input: PayrollARoundingCommand, sessionId?: string | null): Promise<PayrollARoundingCommandResult> {
      const command = parsePayrollARoundingCommand(input)
      return run({ origin: command.origin, projectId: command.scope.projectId, month: command.scope.month }, sessionId, async (db, context, source) => {
        await initializePayrollARoundingSchema(db)
        if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
          throw payrollProblem('forbidden', 'A 工资取整提交身份或工作区已变化')
        const fingerprint = hash(command)
        const [receipt] = await db.select<{ fingerprint: string, actor_id: string, result_json: string }>('SELECT fingerprint,actor_id,result_json FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
        if (receipt) {
          if (receipt.fingerprint !== fingerprint || receipt.actor_id !== context.actorId)
            throw payrollProblem('conflict', '同一 A 工资取整提交编号不能改用其他内容')
          return JSON.parse(receipt.result_json) as PayrollARoundingCommandResult
        }
        const current = await read(db, context, source, command.scope)
        if (current.context.sourceVersion !== command.sourceVersion)
          throw payrollProblem('stale-source', 'A 工资取整配置或所属工资簿已变化，请保留输入重新读取')
        if (current.readonlyReasons.length)
          throw payrollProblem('conflict', current.readonlyReasons[0]!)
        const [purpose, managementBookId] = bookWhere(command.scope)
        const previous = current.revisions.at(-1)
        const now = new Date().toISOString()
        const id = generateId('payroll-a-rounding')
        await db.execute('INSERT INTO payroll_a_rounding_revisions(id,project_id,leader_worker_id,book_purpose,management_book_id,effective_month,revision,rule_json,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [id, command.scope.projectId, command.scope.leaderWorkerId, purpose, managementBookId, command.scope.month, (previous?.revision ?? 0) + 1, payrollCanonical(command.action.rule), context.actorId, now])
        await advancePayrollRevision(db)
        const [saved] = (await revisions(db, command.scope)).filter(row => row.id === id)
        if (!saved)
          throw payrollProblem('not-found', 'A 工资取整保存后无法回读')
        const result: PayrollARoundingCommandResult = { schemaVersion: 1, commandId: command.commandId, revision: saved, sourceVersion: `payroll:${await payrollRevision(db)}` }
        await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?,?)', [command.commandId, context.actorId, command.scope.projectId, null, payrollCanonical(command.scope), command.action.kind, fingerprint, payrollCanonical(result), payrollCanonical(command)])
        return result
      }, true)
    },
  }
}
