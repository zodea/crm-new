import type { PayrollACommand, PayrollAFrozenDocument, PayrollALine } from './central-a-contract'
import type { PayrollDb } from './statements'
import { payrollACanonical, payrollALines } from './central-a-calculation'
import { encodePayrollAWire, isPayrollAFrozenDocument, isPayrollAStatementSourceSnapshot, parsePayrollACommand } from './central-a-codec'
import { payrollObject } from './central-snapshot'
import { amountInCents } from './statements'

function parsed(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string')
    return null
  try {
    const data: unknown = JSON.parse(value)
    return payrollObject(data) ? data : null
  }
  catch { return null }
}

async function originalCommand(raw: unknown, fingerprint: unknown): Promise<PayrollACommand | null> {
  if (typeof raw !== 'string' || typeof fingerprint !== 'string')
    return null
  const value = parsed(raw)
  if (!value || payrollACanonical(value) !== raw)
    return null
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== fingerprint)
    return null
  try {
    return parsePayrollACommand(encodePayrollAWire(value))
  }
  catch { return null }
}
const same = (a: unknown, b: unknown) => payrollACanonical(a) === payrollACanonical(b)
const ids = (values: string[]) => [...values].sort()
function calculation(lines: PayrollALine[]) {
  return lines.map(line => payrollACanonical({ workerId: line.workerId, itemId: line.itemId, unit: line.unit, quantity: line.quantity, knownQuantity: line.knownQuantity, unitPrice: line.unitPrice, amount: line.amount, priceRevisionIds: ids(line.priceRevisionIds), facts: line.facts.map(payrollACanonical).sort() })).sort()
}

/** 来源、冻结与成功回执必须相互匹配；旧库仿同结构字段本身不能证明中央发放。 */
export async function loadPayrollAReleasedDocuments(db: PayrollDb, statementId?: string): Promise<Map<string, PayrollAFrozenDocument>> {
  const documents = new Map<string, PayrollAFrozenDocument>()
  const tables = await db.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name IN (\'payroll_a_statement_sources\',\'payroll_command_receipts\')')
  if (tables.length !== 2 || !(await db.select<{ name: string }>('PRAGMA table_info(payroll_command_receipts)')).some(column => column.name === 'command_json'))
    return documents
  // 已发事实包含软删原头，隐藏或删除不能解除其冻结与来源归属。
  const rows = await db.select<Record<string, unknown>>(`SELECT w.id,w.project_id,w.crew_id,w.leader_worker_id,w.month,w.gross_amount,w.actual_amount,w.snapshot_json,
    s.project_id AS source_project_id,s.leader_worker_id AS source_leader_id,s.source_json,
    r.command_id,r.actor_id,r.project_id AS receipt_project_id,r.fingerprint,r.result_json,r.command_json
    FROM wage_statements w JOIN payroll_a_statement_sources s ON s.statement_id=w.id
    JOIN payroll_command_receipts r ON r.statement_id=w.id AND r.action='release-a'
    WHERE w.status='released' AND w.format_family='A'${statementId ? ' AND w.id=?' : ''}`, statementId ? [statementId] : [])
  for (const row of rows) {
    const snapshot = parsed(row.snapshot_json)
    const source = parsed(row.source_json)
    const result = parsed(row.result_json)
    const document = snapshot?.aDocument
    const command = await originalCommand(row.command_json, row.fingerprint)
    if (!snapshot || !isPayrollAFrozenDocument(document) || !isPayrollAStatementSourceSnapshot(source) || !result
      || document.id !== row.id || document.projectId !== row.project_id || row.source_project_id !== row.project_id || row.source_leader_id !== row.leader_worker_id
      || source.subject.projectId !== row.project_id || source.subject.leaderWorkerId !== row.leader_worker_id || source.subject.crewId !== row.crew_id
      || document.month !== row.month || document.grossAmount !== row.gross_amount || document.actualAmount !== row.actual_amount
      || row.receipt_project_id !== row.project_id || result.commandId !== row.command_id || result.statementId !== row.id || result.projectId !== row.project_id || result.outcome !== 'released'
      || !command || command.action.kind !== 'release-a' || command.commandId !== row.command_id || command.actorId !== row.actor_id || command.origin !== 'real'
      || command.projectId !== row.project_id || command.statementId !== row.id || command.draftKey !== null || command.configScope !== null
      || document.operatorName !== row.actor_id || command.action.release.actualAmount !== document.actualAmount) {
      continue
    }
    const submittedAllocations = command.action.release.allocations.map(allocation => payrollACanonical([allocation.workerId, allocation.amount === null ? null : amountInCents(allocation.amount)])).sort()
    const frozenAllocations = document.allocations.map(allocation => payrollACanonical([allocation.workerId, allocation.allocatedAmountFen])).sort()
    if (!same(snapshot.aSource, source) || !same(source.adjustmentReconciliation, document.adjustmentReconciliation) || !Object.entries(document).every(([key, value]) => same(snapshot[key], value))
      || !same(ids(source.subject.memberWorkerIds), ids(document.members.map(member => member.workerId)))
      || !document.members.some(member => member.isLeader && member.workerId === source.subject.leaderWorkerId)
      || !same(source.facts.map(payrollACanonical).sort(), document.lines.flatMap(line => line.facts).map(payrollACanonical).sort())
      || !same(ids(source.priceRevisions.map(price => price.id)), ids([...new Set(document.lines.flatMap(line => line.priceRevisionIds))]))
      || source.priceRevisions.some(price => price.projectId !== source.subject.projectId || price.crewId !== source.subject.crewId || price.leaderWorkerId !== source.subject.leaderWorkerId)
      || !same(calculation(payrollALines(source.facts, source.priceRevisions, source.subject, document.month)), calculation(document.lines))
      || !same(submittedAllocations, frozenAllocations)) {
      continue
    }
    documents.set(document.id, document)
  }
  return documents
}
