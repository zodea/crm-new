import type { PayrollC2FrozenDocument } from './central-c2-contract'
import type { PayrollHollowProjectionProvider } from './central-hollow-deduction-projection'
import type { PayrollDb } from './statements'
import { decodePayrollC2Result, encodePayrollC2Wire, isPayrollC2FrozenDocument, isPayrollC2StatementSourceVersioned, parsePayrollC2Command } from './central-c2-codec'
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
/** 专属 C2 冻结必须和原逐签工、配置、物理关联及原成功命令互证。 */
export async function loadPayrollC2ReleasedDocuments(db: PayrollDb, statementId?: string, hollowProjection?: PayrollHollowProjectionProvider): Promise<Map<string, PayrollC2FrozenDocument>> {
  const result = new Map<string, PayrollC2FrozenDocument>()
  if ((await db.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name IN (\'payroll_c2_statement_sources\',\'payroll_command_receipts\')')).length !== 2 || !(await db.select<{ name: string }>('PRAGMA table_info(payroll_command_receipts)')).some(c => c.name === 'command_json'))
    return result
  const rows = await db.select<Record<string, unknown>>(`SELECT w.*,s.source_json,s.project_id AS source_project_id,s.leader_worker_id AS source_leader_id,
    r.command_id,r.actor_id,r.project_id AS receipt_project_id,r.command_json,r.fingerprint,r.result_json
    FROM wage_statements w JOIN payroll_c2_statement_sources s ON s.statement_id=w.id
    JOIN payroll_command_receipts r ON r.statement_id=w.id AND r.action='release-c2'
    WHERE w.format_family='C2' AND w.status='released'${statementId ? ' AND w.id=?' : ''}`, statementId ? [statementId] : [])
  for (const row of rows) {
    try {
      const snapshot: unknown = JSON.parse(String(row.snapshot_json))
      const source: unknown = JSON.parse(String(row.source_json))
      const original: unknown = JSON.parse(String(row.command_json))
      if (!payrollObject(snapshot) || !isPayrollC2StatementSourceVersioned(source) || !isPayrollC2FrozenDocument(snapshot.c2Document) || payrollCanonical(original) !== row.command_json || await digest(String(row.command_json)) !== row.fingerprint)
        continue
      const command = parsePayrollC2Command(encodePayrollC2Wire(original))
      const receipt = decodePayrollC2Result(JSON.parse(String(row.result_json)), command)
      const document = snapshot.c2Document
      if (!payrollCHollowSourceMatchesDocument(source, document) || (document.hollow && !await provePayrollHollowFrozen(db, document.hollow, document.id, hollowProjection)))
        continue
      if (command.action.kind !== 'release-c2' || command.commandId !== row.command_id || command.actorId !== row.actor_id || command.origin !== 'real' || command.projectId !== row.project_id || command.statementId !== row.id || row.receipt_project_id !== row.project_id || receipt.statementId !== row.id || receipt.outcome !== 'released' || receipt.configId !== source.config.id || document.id !== row.id || document.projectId !== row.project_id || document.crewId !== row.crew_id || document.month !== row.month || document.grossAmount !== row.gross_amount || document.actualAmount !== row.actual_amount || source.config.id !== row.subject_config_id || source.subject.projectId !== row.project_id || source.subject.leaderWorkerId !== row.leader_worker_id || row.source_project_id !== row.project_id || row.source_leader_id !== row.leader_worker_id || document.operatorName !== row.actor_id || !document.members.some(m => m.workerId === source.subject.leaderWorkerId && m.isLeader))
        continue
      if (!same(snapshot.c2Source, source) || !Object.entries(document).every(([key, value]) => same(snapshot[key], value)) || !same(source.facts, document.daywork) || !same(source.config, document.config) || !same(source.members.map(m => [m.workerId, m.workerName]).sort(), document.members.map(m => [m.workerId, m.workerName]).sort()) || source.month !== document.month || source.subject.crewId !== document.crewId || !command.sourceVersion.includes(`+c2:${await digest(payrollCanonical(source))}+locks:`))
        continue
      if (source.config.sourceFingerprint !== await digest(payrollCanonical(source.config.original)) || (await Promise.all(source.facts.map(async fact => fact.sourceFingerprint === await digest(payrollCanonical(fact.original))))).some(valid => !valid))
        continue
      if (!Array.isArray(snapshot.dayworkLinks) || !snapshot.dayworkLinks.every(l => payrollObject(l) && typeof l.id === 'string' && typeof l.dayworkRecordId === 'string'))
        continue
      const links = snapshot.dayworkLinks.filter((l): l is Record<string, unknown> => payrollObject(l))
      if (!same(links.map(l => l.id).sort(), [...receipt.dayworkLinkIds].sort()) || !same(links.map(l => l.dayworkRecordId).sort(), [...receipt.dayworkRecordIds].sort()) || !same([...receipt.dayworkRecordIds].sort(), source.facts.map(f => f.id).sort()) || !same(snapshot.subjectConfig, source.config) || !same(snapshot.dayworkRecords, source.facts))
        continue
      if (command.action.release.actualAmount !== document.actualAmount || !same(command.action.release.allocations.map(a => [a.workerId, a.amount === null ? null : amountInCents(a.amount)]).sort(), document.allocations.map(a => [a.workerId, a.allocatedAmountFen]).sort()))
        continue
      result.set(document.id, document)
    }
    catch { /* 缺损证据只保原历史，不补当前姓名、单价或签工。 */ }
  }
  return result
}
