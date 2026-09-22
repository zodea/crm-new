import type { PayrollC1FrozenDocument } from './central-c1-contract'
import type { PayrollHollowProjectionProvider } from './central-hollow-deduction-projection'
import type { PayrollDb } from './statements'
import { decodePayrollC1Result, encodePayrollC1Wire, isPayrollC1FrozenDocument, isPayrollC1StatementSourceVersioned, parsePayrollC1Command } from './central-c1-codec'
import { payrollCHollowSourceMatchesDocument } from './central-c-hollow'
import { payrollCanonical } from './central-command-shared'
import { provePayrollHollowFrozen } from './central-hollow-deduction-provenance'
import { payrollObject } from './central-snapshot'
import { amountInCents } from './statements'

async function digest(value: string) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const same = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
/** 输出须同时证明原逐日来源、费率、冻结和成功命令，旧仿形 JSON 不升级为日常工资。 */
export async function loadPayrollC1ReleasedDocuments(db: PayrollDb, statementId?: string, hollowProjection?: PayrollHollowProjectionProvider): Promise<Map<string, PayrollC1FrozenDocument>> {
  const result = new Map<string, PayrollC1FrozenDocument>()
  if ((await db.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name IN (\'payroll_c1_statement_sources\',\'payroll_command_receipts\')')).length !== 2 || !(await db.select<{ name: string }>('PRAGMA table_info(payroll_command_receipts)')).some(c => c.name === 'command_json'))
    return result
  const rows = await db.select<Record<string, unknown>>(`SELECT w.id,w.project_id,w.crew_id,w.leader_worker_id,w.month,w.gross_amount,w.actual_amount,w.snapshot_json,s.source_json,s.project_id AS source_project_id,s.leader_worker_id AS source_leader_id,
    r.command_id,r.actor_id,r.project_id AS receipt_project_id,r.command_json,r.fingerprint,r.result_json
    FROM wage_statements w JOIN payroll_c1_statement_sources s ON s.statement_id=w.id
    JOIN payroll_command_receipts r ON r.statement_id=w.id AND r.action='release-c1'
    WHERE w.format_family='C1' AND w.status='released'${statementId ? ' AND w.id=?' : ''}`, statementId ? [statementId] : [])
  for (const row of rows) {
    try {
      const snapshot: unknown = JSON.parse(String(row.snapshot_json))
      const source: unknown = JSON.parse(String(row.source_json))
      const original: unknown = JSON.parse(String(row.command_json))
      if (!payrollObject(snapshot) || !isPayrollC1StatementSourceVersioned(source) || !isPayrollC1FrozenDocument(snapshot.c1Document) || payrollCanonical(original) !== row.command_json || await digest(String(row.command_json)) !== row.fingerprint)
        continue
      const command = parsePayrollC1Command(encodePayrollC1Wire(original))
      const receipt = decodePayrollC1Result(JSON.parse(String(row.result_json)), command)
      const d = snapshot.c1Document
      if (!payrollCHollowSourceMatchesDocument(source, d) || (d.hollow && !await provePayrollHollowFrozen(db, d.hollow, d.id, hollowProjection)))
        continue
      if (d.crewId !== row.crew_id || d.month !== row.month || d.grossAmount !== row.gross_amount || d.actualAmount !== row.actual_amount)
        continue
      if (command.action.kind !== 'release-c1' || command.commandId !== row.command_id || command.actorId !== row.actor_id || command.origin !== 'real' || command.projectId !== row.project_id || command.statementId !== row.id || row.receipt_project_id !== row.project_id || receipt.statementId !== row.id || receipt.outcome !== 'released' || d.id !== row.id || d.projectId !== row.project_id || source.subject.projectId !== row.project_id || source.subject.leaderWorkerId !== row.leader_worker_id || row.source_project_id !== row.project_id || row.source_leader_id !== row.leader_worker_id || d.operatorName !== row.actor_id || !d.members.some(m => m.workerId === source.subject.leaderWorkerId && m.isLeader))
        continue
      if (!same(snapshot.c1Source, source) || !Object.entries(d).every(([key, value]) => same(snapshot[key], value)) || !same(source.facts, d.attendance) || !same(source.rates, d.rates) || !same([...source.subject.memberWorkerIds].sort(), d.members.map(m => m.workerId).sort()) || source.month !== d.month || source.subject.crewId !== d.crewId || !command.sourceVersion.includes(`+c1:${await digest(payrollCanonical(source))}+locks:`))
        continue
      if (command.action.release.actualAmount !== d.actualAmount || !same(command.action.release.allocations.map(a => [a.workerId, a.amount === null ? null : amountInCents(a.amount)]).sort(), d.allocations.map(a => [a.workerId, a.allocatedAmountFen]).sort()))
        continue
      result.set(d.id, d)
    }
    catch { /* 不完整或损坏证据继续走原历史阅读。 */ }
  }
  return result
}
