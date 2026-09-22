import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollContext, PayrollQuery } from '../../app/lib/payroll/central-contract'
import type { PayrollHollowCommand, PayrollHollowCommandResult, PayrollHollowConfigQuery, PayrollHollowPolicyRevision, PayrollHollowRead, PayrollHollowSelectedLine, PayrollHollowStart } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { PayrollHollowProjectionProvider } from '../../app/lib/payroll/central-hollow-deduction-projection'
import type { PayrollIdentitySource, PayrollRun } from './payroll-service'
import { payrollAAmount, payrollAMoney } from '../../app/lib/payroll/central-a-calculation'
import { payrollCanonical, payrollWriteRow } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { calculatePayrollHollowTotals } from '../../app/lib/payroll/central-hollow-deduction-calculation'
import { encodePayrollHollowWire, parsePayrollHollowCommand } from '../../app/lib/payroll/central-hollow-deduction-codec'
import { advancePayrollRevision, payrollRevision } from '../../app/lib/payroll/central-schema'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { generateId } from '../../app/lib/util/id'
import { readPayrollHollowConfig } from './payroll-hollow-config'
import { payrollHollowHash, payrollHollowPolicyRow, readPayrollHollowReceipt, samePayrollHollowValue } from './payroll-hollow-data'
import { payrollHollowStartRow } from './payroll-hollow-starts'

export type PayrollHollowFormReader = (db: TransactionDb, context: PayrollContext, source: PayrollIdentitySource, statementId: string) => Promise<PayrollHollowRead | undefined>

export function createPayrollHollowService(run: PayrollRun, forms: Partial<Record<'A' | 'C1' | 'C2', PayrollHollowFormReader>>, provider?: PayrollHollowProjectionProvider) {
  return {
    hollowConfig: (query: PayrollQuery, config: PayrollHollowConfigQuery, sessionId?: string | null) => run(query, sessionId, (db, context, source) => {
      if (query.projectId && query.projectId !== config.scope.projectId)
        throw payrollProblem('relationship-mismatch', '空鼓配置与指定工资项目不一致')
      return readPayrollHollowConfig(db, context, source, config, provider)
    }),
    async executeHollow(input: PayrollHollowCommand, sessionId?: string | null): Promise<PayrollHollowCommandResult> {
      const command = parsePayrollHollowCommand(encodePayrollHollowWire(input))
      let absent = false
      try {
        return await run({ origin: command.origin, projectId: command.projectId }, sessionId, async (db, context, source) => {
          if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId)
            throw payrollProblem('forbidden', '空鼓扣款命令与当前工作区或身份不一致')
          const [receipt] = await db.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
          if (receipt) {
            if (receipt.actor_id !== context.actorId || receipt.fingerprint !== payrollHollowHash(command))
              throw payrollProblem('conflict', '同一空鼓扣款提交编号不能改用其他内容')
            const proven = readPayrollHollowReceipt(receipt)
            if (!samePayrollHollowValue(proven.command, command))
              throw payrollProblem('conflict', '原空鼓扣款提交身份与正文不一致')
            return proven.result
          }
          absent = true
          const [before] = await db.select<{ value: number }>('SELECT COALESCE(MAX(rowid),0) AS value FROM operation_logs')
          const result: PayrollHollowCommandResult = { commandId: command.commandId, projectId: command.projectId, statementId: command.target?.statementId ?? null, startId: null, policyRevisionIds: [], sourceVersion: '', outcome: command.action.kind === 'start-hollow-deduction' ? 'started' : 'saved', logIds: [] }
          if (command.action.kind === 'save-hollow-policies') {
            const read = await readPayrollHollowConfig(db, context, source, command.config!, provider)
            if (command.sourceVersion !== read.context.sourceVersion)
              throw payrollProblem('stale-source', '空鼓配置或原主体已变化，请保留输入重新读取')
            if (!read.eligibility.canSave)
              throw payrollProblem('validation-failed', read.reasons[0] ?? '当前空鼓配置不可修改')
            for (const draft of command.action.policies) {
              if (!read.policies.some(policy => policy.itemId === draft.itemId))
                throw payrollProblem('relationship-mismatch', '空鼓配置分项不属于当前项目')
              const chain = read.revisions.filter(revision => revision.itemId === draft.itemId)
              const previous = chain.find(revision => !chain.some(next => next.previousRevisionId === revision.id))
              if (previous ? previous.id !== draft.baseRevisionId || previous.policyId !== draft.policyId : draft.baseRevisionId !== null || draft.policyId !== null)
                throw payrollProblem('stale-source', '空鼓配置已出现新修订，请保留输入重新读取')
              if (draft.effectiveMonth !== command.config!.month || (previous && draft.effectiveMonth < previous.effectiveMonth))
                throw payrollProblem('validation-failed', '空鼓配置须从当前所选新月份生效，不能回写原历史')
              const { baseRevisionId, ...values } = draft
              const revision: PayrollHollowPolicyRevision = { ...values, id: generateId('hollow-policy-revision'), policyId: draft.policyId ?? generateId('hollow-policy'), previousRevisionId: baseRevisionId, scope: command.config!.scope, commandId: command.commandId, createdBy: context.actorId, createdAt: new Date().toISOString() }
              await payrollWriteRow(db, 'payroll_hollow_policy_revisions', revision.id, payrollHollowPolicyRow(revision), context.actorId)
              result.policyRevisionIds.push(revision.id)
            }
          }
          else {
            const [head] = await db.select<{ format_family: 'A' | 'C1' | 'C2', project_id: string, status: string, deleted_at: string | null }>('SELECT format_family,project_id,status,deleted_at FROM wage_statements WHERE id=?', [command.target!.statementId])
            if (!head || head.project_id !== command.projectId)
              throw payrollProblem('relationship-mismatch', '空鼓启动必须绑定同项目的真实已存工资')
            if (!['draft', 'checked'].includes(head.status) || head.deleted_at !== null)
              throw payrollProblem('conflict', '只有未发且可用的工资可以明确开始扣款')
            const read = await forms[head.format_family]?.(db, context, source, command.target!.statementId!)
            if (!read?.scope || !read.snapshot || !read.month)
              throw payrollProblem('unavailable', '当前工资空鼓来源尚未完整接入')
            if (read.context.sourceVersion !== command.sourceVersion)
              throw payrollProblem('stale-source', '原空鼓、整改或配置已变化，请保留输入重新读取')
            if (!read.eligibility.canStart)
              throw payrollProblem('validation-failed', read.eligibility.reasons[0] ?? '当前空鼓不可启动')
            const lines: PayrollHollowSelectedLine[] = read.rows.filter(row => row.state === 'ready').map(row => ({ recordId: row.fact.recordId, proof: row.fact.proof, fact: row.fact, policy: row.policy, count: row.fact.remainingCount, unitAmount: row.policy.unitAmount!, amount: row.amount.value! }))
            const amount = payrollAMoney(lines.reduce((sum, line) => sum + line.amount, 0))
            const totals = calculatePayrollHollowTotals({ formatFamily: read.scope.formatFamily, claimSubtotal: read.totals.claimSubtotal, previousProcessed: read.totals.previousProcessed, currentDeduction: payrollAAmount([amount]) })
            if (totals.reasons.length)
              throw payrollProblem('validation-failed', totals.reasons[0]!)
            const start: PayrollHollowStart = { id: generateId('hollow-start'), projectId: command.projectId, statementId: command.target!.statementId!, previousStartId: read.snapshot.start?.id ?? null, scope: read.scope, month: read.month, sourceVersion: command.sourceVersion, lines, amount, commandId: command.commandId, createdBy: context.actorId, createdAt: new Date().toISOString() }
            await payrollWriteRow(db, 'payroll_hollow_starts', start.id, payrollHollowStartRow(start), context.actorId)
            // 新启动使旧核对失效；重核会同时冻结来源、计算与采用端点。
            await payrollWriteRow(db, 'wage_statements', start.statementId, { needs_recheck: Number(head.status === 'checked'), updated_at: new Date().toISOString() }, context.actorId)
            result.startId = start.id
          }
          await advancePayrollRevision(db)
          result.sourceVersion = `payroll:${await payrollRevision(db)}`
          result.logIds = (await db.select<{ id: string }>('SELECT id FROM operation_logs WHERE rowid>? ORDER BY rowid', [before?.value ?? 0])).map(row => row.id)
          await db.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,statement_id,config_scope_json,action,fingerprint,result_json,command_json) VALUES(?,?,?,?,?,?,?,?,?)', [command.commandId, command.actorId, command.projectId, result.statementId, command.config === null ? null : payrollCanonical(command.config), command.action.kind, payrollHollowHash(command), payrollCanonical(result), payrollCanonical(command)])
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
