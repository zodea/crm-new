import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollHollowAdoption, PayrollHollowStart } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { PayrollHollowProjectionProvider } from '../../app/lib/payroll/central-hollow-deduction-projection'
import type { PayrollHollowSqlRow } from './payroll-hollow-data'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollHollowStartLogsProven } from '../../app/lib/payroll/central-hollow-deduction-provenance'
import { isPayrollHollowAdoption, isPayrollHollowSnapshot, isPayrollHollowStart } from '../../app/lib/payroll/central-hollow-deduction-snapshot'
import { payrollHollowHash, payrollHollowJson, payrollHollowUnproven, readPayrollHollowReceipt, samePayrollHollowScope, samePayrollHollowValue } from './payroll-hollow-data'

export function payrollHollowStartRow(start: PayrollHollowStart): PayrollHollowSqlRow {
  return { id: start.id, project_id: start.projectId, statement_id: start.statementId, previous_start_id: start.previousStartId, command_id: start.commandId, start_json: payrollCanonical(start), created_by: start.createdBy, created_at: start.createdAt }
}
export function payrollHollowAdoptionRow(adoption: PayrollHollowAdoption): PayrollHollowSqlRow {
  return { id: adoption.id, project_id: adoption.projectId, statement_id: adoption.statementId, start_id: adoption.startId, record_id: adoption.line.recordId, command_id: adoption.commandId, adoption_json: payrollCanonical(adoption), created_by: adoption.createdBy, created_at: adoption.createdAt }
}
async function proveAppend(tx: TransactionDb, table: string, row: PayrollHollowSqlRow, actor: string, ids: string[]) {
  const logs = await tx.select<PayrollHollowSqlRow>('SELECT * FROM operation_logs WHERE table_name=? AND record_id=?', [table, row.id])
  if (logs.length !== 1 || logs[0]!.action !== 'create' || logs[0]!.operator !== actor || logs[0]!.before_data !== null || !ids.includes(String(logs[0]!.id)) || !samePayrollHollowValue(payrollHollowJson(logs[0]!.after_data), row))
    payrollHollowUnproven('空鼓采用记录的原追加日志无法证明')
}
export async function loadPayrollHollowStarts(tx: TransactionDb, projectId: string, provider?: PayrollHollowProjectionProvider): Promise<PayrollHollowStart[]> {
  const imported = await provider?.(tx, projectId)
  const rows = await tx.select<PayrollHollowSqlRow>('SELECT * FROM payroll_hollow_starts WHERE project_id=?', [projectId])
  const receipts = await tx.select<PayrollHollowSqlRow>('SELECT * FROM payroll_command_receipts WHERE project_id=? AND action=\'start-hollow-deduction\'', [projectId])
  const starts: PayrollHollowStart[] = []
  for (const receipt of receipts) {
    if (imported?.unavailableIds.has(String(receipt.command_id)))
      payrollHollowUnproven('迁入空鼓启动回执无法证明')
    const projected = imported?.receipts.get(String(receipt.command_id))
    if (projected) {
      const own = rows.filter(row => row.command_id === projected.command.commandId)
      const start = projected.result.startId ? imported!.starts.get(projected.result.startId) : null
      if (!start || own.length !== 1 || own[0]!.id !== start.id)
        payrollHollowUnproven('迁入空鼓启动的唯一原记录集合已变化')
      starts.push(start)
      continue
    }
    const { command, result } = readPayrollHollowReceipt(receipt)
    const own = rows.filter(row => row.command_id === command.commandId)
    if (command.action.kind !== 'start-hollow-deduction' || own.length !== 1 || own[0]!.id !== result.startId)
      payrollHollowUnproven('人工启动的原命令与唯一采用范围不一致')
    const row = own[0]!
    const start = payrollHollowJson(row.start_json)
    if (!isPayrollHollowStart(start) || start.commandId !== command.commandId || start.createdBy !== command.actorId || start.projectId !== command.projectId || start.statementId !== command.target?.statementId || start.sourceVersion !== command.sourceVersion
      || !samePayrollHollowValue(row, { ...payrollHollowStartRow(start), start_json: row.start_json })) {
      payrollHollowUnproven('人工启动的原数量、单价或身份已变化')
    }
    await proveAppend(tx, 'payroll_hollow_starts', row, command.actorId, result.logIds)
    if (!await payrollHollowStartLogsProven(tx, start, result.logIds))
      payrollHollowUnproven('人工启动缺少同事务工资重核标记日志')
    starts.push(start)
  }
  if (rows.length !== starts.length)
    payrollHollowUnproven('空鼓启动记录缺少原确认回执，不能继续扣款')
  for (const statementId of new Set(starts.map(start => start.statementId))) {
    const own = starts.filter(start => start.statementId === statementId)
    const roots = own.filter(start => start.previousStartId === null)
    const visited = new Set<string>()
    if (roots.length !== 1)
      payrollHollowUnproven('人工启动的原链缺失或分叉')
    let current: PayrollHollowStart | undefined = roots[0]
    while (current) {
      if (visited.has(current.id) || !samePayrollHollowScope(current.scope, roots[0]!.scope) || current.month !== roots[0]!.month)
        payrollHollowUnproven('人工启动不能循环或改变原单主体期间')
      visited.add(current.id)
      const id = current.id
      const children = own.filter(start => start.previousStartId === id)
      if (children.length > 1)
        payrollHollowUnproven('人工启动出现多个同前序确认')
      current = children[0]
    }
    if (visited.size !== own.length)
      payrollHollowUnproven('人工启动有无法连接原链的记录')
  }
  return starts
}

/** 原件交叉证明，不依赖当前来源；当前空鼓改变不能抹去已处理范围。 */
export async function loadPayrollHollowAdoptions(tx: TransactionDb, projectId: string, starts: PayrollHollowStart[], provider?: PayrollHollowProjectionProvider): Promise<PayrollHollowAdoption[]> {
  const imported = await provider?.(tx, projectId)
  const rows = await tx.select<PayrollHollowSqlRow>('SELECT * FROM payroll_hollow_adoptions WHERE project_id=?', [projectId])
  const heads = await tx.select<PayrollHollowSqlRow>('SELECT * FROM wage_statements WHERE project_id=? AND status=\'released\'', [projectId])
  const result: PayrollHollowAdoption[] = []
  for (const row of rows) {
    if (imported?.unavailableIds.has(String(row.id)))
      payrollHollowUnproven('迁入空鼓采用原件无法证明')
    const projected = imported?.adoptions.get(String(row.id))
    if (projected) {
      if (!starts.some(start => start.id === projected.startId) || !heads.some(head => head.id === projected.statementId))
        payrollHollowUnproven('迁入空鼓采用失去原启动或已发工资')
      result.push(projected)
      continue
    }
    const adoption = payrollHollowJson(row.adoption_json)
    if (!isPayrollHollowAdoption(adoption) || !samePayrollHollowValue(row, { ...payrollHollowAdoptionRow(adoption), adoption_json: row.adoption_json }))
      payrollHollowUnproven('原空鼓实际采用内容与物理身份不一致')
    const start = starts.find(start => start.id === adoption.startId)
    const head = heads.find(head => head.id === adoption.statementId)
    if (!start || !head || start.statementId !== adoption.statementId || !samePayrollHollowScope(start.scope, adoption.scope) || start.month !== adoption.month || !start.lines.some(line => samePayrollHollowValue(line, adoption.line)))
      payrollHollowUnproven('原空鼓采用没有同一工资的完整启动与发放记录')
    const raw = payrollHollowJson(head.snapshot_json) as Record<string, unknown> | null
    const document = raw?.[`${start.scope.formatFamily.toLowerCase()}Document`] as Record<string, unknown> | null
    const hollow = imported?.documents.get(String(head.id)) ?? document?.hollow
    const [receipt] = await tx.select<PayrollHollowSqlRow>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [adoption.commandId])
    if (!raw || !document || !receipt || !isPayrollHollowSnapshot(hollow) || hollow.state !== 'available' || !samePayrollHollowValue(hollow.start, start)
      || !hollow.adoptions.some(value => samePayrollHollowValue(value, adoption)) || hollow.adoptions.length !== start.lines.length
      || document.id !== head.id || document.projectId !== projectId || document.actualAmount !== head.actual_amount || document.grossAmount !== head.gross_amount || document.month !== head.month
      || head.format_family !== start.scope.formatFamily || head.month !== start.month || head.leader_worker_id !== start.scope.leaderWorkerId || head.crew_id !== start.scope.crewId) {
      payrollHollowUnproven('原空鼓采用与工资冻结原文不一致')
    }
    const command = payrollHollowJson(receipt.command_json) as Record<string, unknown> | null
    const outcome = payrollHollowJson(receipt.result_json) as Record<string, unknown> | null
    const action = command?.action as Record<string, unknown> | null
    const release = action?.release as Record<string, unknown> | null
    if (!command || !outcome || !action || !release || receipt.fingerprint !== payrollHollowHash(command) || command.commandId !== adoption.commandId || command.actorId !== adoption.createdBy
      || receipt.actor_id !== command.actorId || receipt.statement_id !== adoption.statementId || receipt.project_id !== projectId || receipt.action !== `release-${start.scope.formatFamily.toLowerCase()}`
      || action.kind !== receipt.action || command.statementId !== adoption.statementId || command.projectId !== projectId || release.actualAmount !== head.actual_amount
      || outcome.commandId !== command.commandId || outcome.statementId !== head.id || outcome.projectId !== projectId || outcome.outcome !== 'released' || !Array.isArray(outcome.logIds) || !outcome.logIds.every(id => typeof id === 'string')) {
      payrollHollowUnproven('原空鼓采用缺少同一完整实发命令回执')
    }
    await proveAppend(tx, 'payroll_hollow_adoptions', row, adoption.createdBy, outcome.logIds as string[])
    const logs = await tx.select<PayrollHollowSqlRow>('SELECT * FROM operation_logs WHERE table_name=\'wage_statements\' AND record_id=?', [head.id])
    if (!logs.some(log => (outcome.logIds as string[]).includes(String(log.id)) && log.operator === adoption.createdBy && samePayrollHollowValue((payrollHollowJson(log.after_data) as Record<string, unknown>).snapshot_json, head.snapshot_json)))
      payrollHollowUnproven('原空鼓采用没有工资冻结的同事务日志')
    result.push(adoption)
  }
  for (const head of heads) {
    if (head.snapshot_json === null) {
      if (result.some(adoption => adoption.statementId === head.id) || imported?.documents.has(String(head.id)))
        payrollHollowUnproven('已有空鼓采用的原工资冻结正文缺失')
      // Old released heads without any hollow adoption remain historical gaps, never a zero deduction proof.
      continue
    }
    const raw = payrollHollowJson(head.snapshot_json) as Record<string, unknown> | null
    const document = raw?.[`${String(head.format_family).toLowerCase()}Document`] as Record<string, unknown> | null
    const hollow = imported?.documents.get(String(head.id)) ?? document?.hollow
    if (hollow !== undefined && (!isPayrollHollowSnapshot(hollow) || !samePayrollHollowValue(hollow.adoptions.map(value => value.id).sort(), result.filter(value => value.statementId === head.id).map(value => value.id).sort())))
      payrollHollowUnproven('原工资已处理空鼓的完整集合缺失，不能作为零或再次扣款')
  }
  return result
}
