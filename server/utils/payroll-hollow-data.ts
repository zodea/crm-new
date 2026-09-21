import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollHollowCommand, PayrollHollowCommandResult, PayrollHollowPolicyRevision, PayrollHollowScope } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { PayrollHollowProjectionProvider } from '../../app/lib/payroll/central-hollow-deduction-projection'
import { createHash } from 'node:crypto'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { decodePayrollHollowResult } from '../../app/lib/payroll/central-hollow-deduction-codec'
import { assertPayrollHollowCommand, isPayrollHollowPolicyRevision } from '../../app/lib/payroll/central-hollow-deduction-validation'

export type PayrollHollowSqlRow = Record<string, unknown>
export const payrollHollowHash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
export const samePayrollHollowValue = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
export const samePayrollHollowScope = (a: PayrollHollowScope, b: PayrollHollowScope) => samePayrollHollowValue(a, b)
export function payrollHollowUnproven(message: string): never {
  throw payrollProblem('unavailable', message)
}
export function payrollHollowJson(value: unknown): unknown {
  if (typeof value !== 'string')
    payrollHollowUnproven('原空鼓扣款正文缺失，不能使用默认值补齐')
  try {
    return JSON.parse(value)
  }
  catch {
    return payrollHollowUnproven('原空鼓扣款正文无法读取，请保留原件核实')
  }
}
export function payrollHollowPolicyRow(revision: PayrollHollowPolicyRevision): PayrollHollowSqlRow {
  return {
    id: revision.id,
    policy_id: revision.policyId,
    project_id: revision.scope.projectId,
    crew_id: revision.scope.crewId,
    leader_worker_id: revision.scope.leaderWorkerId,
    format_family: revision.scope.formatFamily,
    book_purpose: revision.scope.book?.bookPurpose ?? null,
    management_book_id: revision.scope.book?.managementBookId ?? null,
    item_id: revision.itemId,
    previous_revision_id: revision.previousRevisionId,
    effective_month: revision.effectiveMonth,
    enabled: Number(revision.enabled),
    unit_amount: revision.unitAmount,
    command_id: revision.commandId,
    revision_json: payrollCanonical(revision),
    created_by: revision.createdBy,
    created_at: revision.createdAt,
  }
}

export function readPayrollHollowReceipt(row: PayrollHollowSqlRow): { command: PayrollHollowCommand, result: PayrollHollowCommandResult } {
  const command = payrollHollowJson(row.command_json)
  try {
    assertPayrollHollowCommand(command)
  }
  catch {
    return payrollHollowUnproven('空鼓扣款回执缺少可核对的原命令')
  }
  if (command.commandId !== row.command_id || command.actorId !== row.actor_id || command.projectId !== row.project_id || command.action.kind !== row.action || row.fingerprint !== payrollHollowHash(command)
    || !samePayrollHollowValue(row.config_scope_json === null ? null : payrollHollowJson(row.config_scope_json), command.config)) {
    payrollHollowUnproven('空鼓扣款回执与原命令身份不一致')
  }
  let result: PayrollHollowCommandResult
  try {
    result = decodePayrollHollowResult(payrollHollowJson(row.result_json), command)
  }
  catch {
    return payrollHollowUnproven('空鼓扣款回执的结果集合无法证明')
  }
  if (row.statement_id !== result.statementId)
    payrollHollowUnproven('空鼓扣款回执的工资目标已变化')
  return { command, result }
}

/** 原生每份修订都回查完整命令结果集合与日志，缺行/多行不能变成默认配置。 */
export async function loadPayrollHollowPolicyRevisions(tx: TransactionDb, projectId: string, provider?: PayrollHollowProjectionProvider): Promise<PayrollHollowPolicyRevision[]> {
  const imported = await provider?.(tx, projectId)
  const rows = await tx.select<PayrollHollowSqlRow>('SELECT * FROM payroll_hollow_policy_revisions WHERE project_id=?', [projectId])
  const receipts = await tx.select<PayrollHollowSqlRow>('SELECT * FROM payroll_command_receipts WHERE project_id=? AND action=\'save-hollow-policies\'', [projectId])
  const values: PayrollHollowPolicyRevision[] = []
  const covered = new Set<string>()
  for (const receipt of receipts) {
    if (imported?.unavailableIds.has(String(receipt.command_id)))
      payrollHollowUnproven('迁入空鼓配置原回执无法证明')
    const projected = imported?.receipts.get(String(receipt.command_id))
    if (projected) {
      const own = rows.filter(row => row.command_id === projected.command.commandId)
      if (!samePayrollHollowValue(own.map(row => row.id).sort(), projected.result.policyRevisionIds.slice().sort()))
        payrollHollowUnproven('迁入空鼓配置的完整修订集合已变化')
      for (const row of own) {
        const revision = imported!.policyRevisions.get(String(row.id))
        if (!revision || covered.has(revision.id))
          payrollHollowUnproven('迁入空鼓配置修订无法证明')
        covered.add(revision.id)
        values.push(revision)
      }
      continue
    }
    const { command, result } = readPayrollHollowReceipt(receipt)
    if (command.action.kind !== 'save-hollow-policies' || !command.config)
      payrollHollowUnproven('空鼓配置命令没有绑定原建档主体')
    const own = rows.filter(row => row.command_id === command.commandId)
    if (own.length !== result.policyRevisionIds.length || own.some(row => !result.policyRevisionIds.includes(String(row.id))))
      payrollHollowUnproven('原空鼓配置修订集合缺失或混入未确认记录')
    const logIds: string[] = []
    for (const [index, id] of result.policyRevisionIds.entries()) {
      const row = own.find(row => row.id === id)
      if (!row || covered.has(id))
        payrollHollowUnproven('原空鼓配置修订缺失或被不同命令重复引用')
      const revision = payrollHollowJson(row.revision_json)
      const draft = command.action.policies[index]!
      if (!isPayrollHollowPolicyRevision(revision) || revision.commandId !== command.commandId || revision.createdBy !== command.actorId
        || !samePayrollHollowScope(revision.scope, command.config.scope) || revision.previousRevisionId !== draft.baseRevisionId
        || (draft.policyId !== null && revision.policyId !== draft.policyId)
        || !samePayrollHollowValue({ itemId: revision.itemId, enabled: revision.enabled, unitAmount: revision.unitAmount, effectiveMonth: revision.effectiveMonth }, { itemId: draft.itemId, enabled: draft.enabled, unitAmount: draft.unitAmount, effectiveMonth: draft.effectiveMonth })) {
        payrollHollowUnproven('原空鼓配置修订内容无法与命令交叉证明')
      }
      const expected = payrollHollowPolicyRow(revision)
      // 原JSON允许既存格式；比较解析后的正文，不回写或重新序列化数据库原文。
      expected.revision_json = row.revision_json
      if (!samePayrollHollowValue(row, expected))
        payrollHollowUnproven('空鼓配置身份映射或物理字段缺少原件证明')
      const logs = await tx.select<PayrollHollowSqlRow>('SELECT * FROM operation_logs WHERE table_name=\'payroll_hollow_policy_revisions\' AND record_id=?', [id])
      if (logs.length !== 1)
        payrollHollowUnproven('原空鼓配置的追加日志集合无法核实')
      const log = logs[0]!
      if (log.action !== 'create' || log.operator !== revision.createdBy || log.before_data !== null || !samePayrollHollowValue(payrollHollowJson(log.after_data), row) || !result.logIds.includes(String(log.id)))
        payrollHollowUnproven('原空鼓配置追加日志与命令结果不一致')
      logIds.push(String(log.id))
      covered.add(id)
      values.push(revision)
    }
    if (!samePayrollHollowValue(logIds.slice().sort(), result.logIds.slice().sort()))
      payrollHollowUnproven('空鼓配置回执包含不属于本次修订的日志')
  }
  if (rows.some(row => !covered.has(String(row.id))))
    payrollHollowUnproven('存在尚未证明原命令的空鼓配置，不能自动采用默认单价')
  for (const policyId of new Set(values.map(value => value.policyId))) {
    const revisions = values.filter(value => value.policyId === policyId)
    const roots = revisions.filter(value => value.previousRevisionId === null)
    if (roots.length !== 1)
      payrollHollowUnproven('空鼓配置原修订链缺失或分叉')
    const visited = new Set<string>()
    let next: PayrollHollowPolicyRevision | undefined = roots[0]
    while (next) {
      if (visited.has(next.id) || !samePayrollHollowScope(next.scope, roots[0]!.scope) || next.itemId !== roots[0]!.itemId)
        payrollHollowUnproven('空鼓配置修订不能循环或更换原主体分项')
      visited.add(next.id)
      const children: PayrollHollowPolicyRevision[] = revisions.filter(value => value.previousRevisionId === next!.id)
      if (children.length > 1)
        payrollHollowUnproven('空鼓配置出现多个同前序修订')
      next = children[0]
    }
    if (visited.size !== revisions.length)
      payrollHollowUnproven('空鼓配置存在无法连接原链的修订')
  }
  return values
}

/** 先按完整修订链选择生效项；同一个policy不能因停用而复活更早启用项。 */
export function effectivePayrollHollowPolicies(revisions: PayrollHollowPolicyRevision[], scope: PayrollHollowScope, month: string): PayrollHollowPolicyRevision[] {
  const selected = new Map<string, PayrollHollowPolicyRevision>()
  for (const policyId of new Set(revisions.filter(revision => samePayrollHollowScope(revision.scope, scope)).map(revision => revision.policyId))) {
    const chain = revisions.filter(revision => revision.policyId === policyId)
    let current = chain.find(revision => revision.previousRevisionId === null)
    let effective: PayrollHollowPolicyRevision | undefined
    while (current) {
      if (current.effectiveMonth <= month && (!effective || current.effectiveMonth >= effective.effectiveMonth))
        effective = current
      const id = current.id
      current = chain.find(revision => revision.previousRevisionId === id)
    }
    if (effective) {
      if (selected.has(effective.itemId))
        payrollHollowUnproven('同一主体分项有多条独立空鼓配置，不能任取单价')
      selected.set(effective.itemId, effective)
    }
  }
  return [...selected.values()]
}
