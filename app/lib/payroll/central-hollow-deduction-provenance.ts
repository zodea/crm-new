import type { QuantityHollowFact } from '../quantity/central-hollow-contract'
import type { QuantityHollowProvenHistory } from '../quantity/central-hollow-proof-contract'
import type { QuantityHollowTables } from '../quantity/central-hollow-schema'
import type { PayrollHollowAdoption, PayrollHollowSnapshot, PayrollHollowStart } from './central-hollow-deduction-contract'
import type { PayrollHollowProjectionProvider, PayrollHollowProvenProjection } from './central-hollow-deduction-projection'
import type { PayrollDb } from './statements'
import { extendQuantityHollowProvenHistory, proveQuantityHollowRecord, quantityHollowFrozenFact } from '../quantity/central-hollow-proof'
import { QUANTITY_HOLLOW_TABLES } from '../quantity/central-hollow-schema'
import { readQuantityHollowMigrationEvidence, verifyQuantityHollowMigrationEvidence } from '../quantity/hollow-migration-source'
import { readQuantityHollowTables } from '../quantity/hollow-migration-tables'
import { payrollCanonical } from './central-command-shared'
import { decodePayrollHollowResult, encodePayrollHollowWire, parsePayrollHollowCommand } from './central-hollow-deduction-codec'
import { isPayrollHollowAdoption, isPayrollHollowSnapshot, isPayrollHollowStart } from './central-hollow-deduction-snapshot'
import { isPayrollHollowPolicyRevision } from './central-hollow-deduction-validation'
import { provePayrollHollowProcessed } from './central-hollow-processed-proof'
import { payrollObject } from './central-snapshot'

type Row = Record<string, unknown>
const same = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
function parsed(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : null
}
async function hash(value: unknown) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payrollCanonical(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function appendProven(db: PayrollDb, table: string, row: Row, actor: string, logIds: unknown): Promise<boolean> {
  const logs = await db.select<Row>('SELECT * FROM operation_logs WHERE table_name=? AND record_id=?', [table, row.id])
  return Array.isArray(logIds) && logs.length === 1 && logIds.includes(logs[0]!.id) && logs[0]!.action === 'create' && logs[0]!.operator === actor && logs[0]!.before_data === null && same(parsed(logs[0]!.after_data), row)
}
export async function payrollHollowStartLogsProven(db: PayrollDb, start: PayrollHollowStart, logIds: string[]): Promise<boolean> {
  if (logIds.length !== 2 || new Set(logIds).size !== 2)
    return false
  const logs = await db.select<Row>(`SELECT * FROM operation_logs WHERE id IN (${logIds.map(() => '?').join(',')})`, logIds)
  const update = logs.find(row => row.table_name === 'wage_statements' && row.record_id === start.statementId && row.action === 'update')
  if (logs.length !== 2 || logs.some(row => row.operator !== start.createdBy) || !update)
    return false
  const before = parsed(update.before_data)
  const after = parsed(update.after_data)
  return payrollObject(before) && payrollObject(after) && before.id === start.statementId && before.project_id === start.projectId
    && before.status !== 'released' && same(after, { ...before, needs_recheck: Number(before.status === 'checked'), updated_at: after.updated_at })
    && typeof after.updated_at === 'string'
}
async function quantityProven(db: PayrollDb, snapshot: PayrollHollowSnapshot): Promise<boolean> {
  const tables = await readQuantityHollowTables(db)
  if (!tables)
    return false
  const evidence = (await readQuantityHollowMigrationEvidence(db)).filter(row => row.project_id === snapshot.scope.projectId)
  if (evidence.length > 1)
    return false
  const migrated = evidence[0] ? await verifyQuantityHollowMigrationEvidence(evidence[0], tables) : null
  const histories = new Map<string, QuantityHollowProvenHistory>()
  const facts: QuantityHollowFact[] = [...snapshot.facts, ...snapshot.previousProcessed.map(row => row.adoption.line.fact)]
  for (const fact of facts) {
    let history = histories.get(fact.recordId)
    if (!history) {
      const prefix = migrated?.histories.get(fact.recordId)
      const owned = new Set(prefix ? [prefix.recordId, ...prefix.steps.flatMap(step => [step.logId, step.receiptId]), ...prefix.fact.revisions.map(row => row.revisionId), ...prefix.fact.rectifications.map(row => row.id)] : [])
      const suffix = Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, tables[table].filter(row => (table === 'quantity_hollow_records' ? row.id === fact.recordId : row.record_id === fact.recordId) && !owned.has(String(row.id)))])) as QuantityHollowTables
      const result = prefix ? await extendQuantityHollowProvenHistory(prefix, suffix) : await proveQuantityHollowRecord({ projectId: snapshot.scope.projectId, recordId: fact.recordId, tables: suffix })
      if (result.status !== 'proven')
        return false
      history = result.history
      histories.set(fact.recordId, history)
    }
    if (!same(quantityHollowFrozenFact(history, fact.proof), fact))
      return false
  }
  return true
}
async function startProven(db: PayrollDb, start: PayrollHollowStart, projection?: PayrollHollowProvenProjection): Promise<boolean> {
  if (projection?.unavailableIds.has(start.id))
    return false
  const projected = projection?.starts.get(start.id)
  if (projected)
    return same(projected, start)
  const [row] = await db.select<Row>('SELECT * FROM payroll_hollow_starts WHERE id=?', [start.id])
  const [receipt] = await db.select<Row>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [start.commandId])
  if (!row || !receipt || !isPayrollHollowStart(start) || !same(parsed(row.start_json), start)
    || !same(row, { id: start.id, project_id: start.projectId, statement_id: start.statementId, previous_start_id: start.previousStartId, command_id: start.commandId, start_json: row.start_json, created_by: start.createdBy, created_at: start.createdAt })) {
    return false
  }
  const command = parsePayrollHollowCommand(encodePayrollHollowWire(parsed(receipt.command_json)))
  const result = decodePayrollHollowResult(parsed(receipt.result_json), command)
  return command.action.kind === 'start-hollow-deduction' && command.commandId === start.commandId && command.actorId === start.createdBy && command.projectId === start.projectId && command.target?.statementId === start.statementId && command.sourceVersion === start.sourceVersion
    && receipt.fingerprint === await hash(command) && receipt.actor_id === command.actorId && receipt.command_id === command.commandId && receipt.project_id === command.projectId && receipt.statement_id === start.statementId && receipt.action === command.action.kind && receipt.config_scope_json === null
    && result.startId === start.id && await appendProven(db, 'payroll_hollow_starts', row, start.createdBy, result.logIds)
    && await payrollHollowStartLogsProven(db, start, result.logIds)
}
async function adoptionProven(db: PayrollDb, adoption: PayrollHollowAdoption, projection?: PayrollHollowProvenProjection): Promise<boolean> {
  if (projection?.unavailableIds.has(adoption.id))
    return false
  const projected = projection?.adoptions.get(adoption.id)
  if (projected)
    return same(projected, adoption)
  const [row] = await db.select<Row>('SELECT * FROM payroll_hollow_adoptions WHERE id=?', [adoption.id])
  const [head] = await db.select<Row>('SELECT * FROM wage_statements WHERE id=?', [adoption.statementId])
  const [receipt] = await db.select<Row>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [adoption.commandId])
  if (!isPayrollHollowAdoption(adoption) || !row || !head || !receipt || !same(parsed(row.adoption_json), adoption)
    || !same(row, { id: adoption.id, project_id: adoption.projectId, statement_id: adoption.statementId, start_id: adoption.startId, record_id: adoption.line.recordId, command_id: adoption.commandId, adoption_json: row.adoption_json, created_by: adoption.createdBy, created_at: adoption.createdAt })) {
    return false
  }
  const raw = parsed(head.snapshot_json)
  const document = payrollObject(raw) ? raw[`${adoption.scope.formatFamily.toLowerCase()}Document`] : null
  const command = parsed(receipt.command_json)
  const result = parsed(receipt.result_json)
  if (!payrollObject(document) || !isPayrollHollowSnapshot(document.hollow) || !payrollObject(command) || !payrollObject(command.action) || !payrollObject(command.action.release) || !payrollObject(result)
    || head.status !== 'released' || head.format_family !== adoption.scope.formatFamily || head.project_id !== adoption.projectId || head.month !== adoption.month || head.leader_worker_id !== adoption.scope.leaderWorkerId || head.crew_id !== adoption.scope.crewId
    || document.id !== head.id || document.projectId !== head.project_id || document.actualAmount !== head.actual_amount || document.grossAmount !== head.gross_amount
    || !document.hollow.adoptions.some(row => same(row, adoption)) || !document.hollow.start || document.hollow.start.id !== adoption.startId
    || command.commandId !== adoption.commandId || command.actorId !== adoption.createdBy || command.statementId !== head.id || command.projectId !== head.project_id || command.action.kind !== `release-${adoption.scope.formatFamily.toLowerCase()}` || command.action.release.actualAmount !== head.actual_amount
    || receipt.fingerprint !== await hash(command) || receipt.actor_id !== command.actorId || receipt.statement_id !== head.id || receipt.project_id !== head.project_id || receipt.action !== command.action.kind
    || result.commandId !== command.commandId || result.statementId !== head.id || result.outcome !== 'released' || result.projectId !== head.project_id) {
    return false
  }
  if (!await startProven(db, document.hollow.start, projection) || !await appendProven(db, 'payroll_hollow_adoptions', row, adoption.createdBy, result.logIds))
    return false
  if (!Array.isArray(result.logIds) || result.logIds.some(id => typeof id !== 'string') || !result.logIds.length || new Set(result.logIds).size !== result.logIds.length)
    return false
  const releaseLogs = await db.select<Row>(`SELECT * FROM operation_logs WHERE id IN (${result.logIds.map(() => '?').join(',')})`, result.logIds)
  if (releaseLogs.length !== result.logIds.length || releaseLogs.some(log => log.operator !== adoption.createdBy)
    || !releaseLogs.some(log => log.table_name === 'wage_statements' && log.record_id === head.id && log.action === 'update' && payrollObject(parsed(log.after_data)) && (parsed(log.after_data) as Row).snapshot_json === head.snapshot_json)) {
    return false
  }
  const own = await db.select<Row>('SELECT * FROM payroll_hollow_adoptions WHERE statement_id=?', [head.id])
  return same(own.map(row => row.id).sort(), document.hollow.adoptions.map(row => row.id).sort())
}

/** 各格式/P4只消费可证明的原件；损坏或旧迁入缺证明一律保留原文但不输出为健康单。 */
export async function provePayrollHollowFrozen(db: PayrollDb, snapshot: PayrollHollowSnapshot, statementId: string, provider?: PayrollHollowProjectionProvider): Promise<boolean> {
  try {
    if (!isPayrollHollowSnapshot(snapshot) || snapshot.state !== 'available' || (snapshot.start && snapshot.start.statementId !== statementId) || !await quantityProven(db, snapshot))
      return false
    const own = await db.select<Row>('SELECT id FROM payroll_hollow_adoptions WHERE statement_id=?', [statementId])
    if (!same(own.map(row => row.id).sort(), snapshot.adoptions.map(row => row.id).sort()))
      return false
    const projection = await provider?.(db, snapshot.scope.projectId)
    if (snapshot.start && (!await startProven(db, snapshot.start, projection) || snapshot.adoptions.length !== snapshot.start.lines.length))
      return false
    for (const adoption of [...snapshot.adoptions, ...snapshot.previousProcessed.map(row => row.adoption)]) {
      if (!await adoptionProven(db, adoption, projection))
        return false
    }
    if (!await provePayrollHollowProcessed(db, snapshot, statementId, projection))
      return false
    for (const policy of snapshot.policies) {
      if (policy.source !== 'configured')
        continue
      if (policy.revisionId && projection?.unavailableIds.has(policy.revisionId))
        return false
      const projected = policy.revisionId ? projection?.policyRevisions.get(policy.revisionId) : null
      if (projected) {
        if (projected.itemId !== policy.itemId || projected.enabled !== policy.enabled || projected.unitAmount !== policy.unitAmount || !same(projected.scope, snapshot.scope) || !projection!.policyVersions.get(projected.id)?.includes(policy.sourceVersion))
          return false
        continue
      }
      const [row] = await db.select<Row>('SELECT * FROM payroll_hollow_policy_revisions WHERE id=?', [policy.revisionId])
      const revision = row ? parsed(row.revision_json) : null
      if (!row || !isPayrollHollowPolicyRevision(revision) || revision.id !== policy.revisionId || revision.itemId !== policy.itemId || revision.enabled !== policy.enabled || revision.unitAmount !== policy.unitAmount || !same(revision.scope, snapshot.scope) || policy.sourceVersion !== await hash(revision))
        return false
      const [receipt] = await db.select<Row>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [revision.commandId])
      if (!receipt)
        return false
      const command = parsePayrollHollowCommand(encodePayrollHollowWire(parsed(receipt.command_json)))
      const result = decodePayrollHollowResult(parsed(receipt.result_json), command)
      if (command.action.kind !== 'save-hollow-policies' || receipt.fingerprint !== await hash(command) || command.actorId !== revision.createdBy || !result.policyRevisionIds.includes(revision.id) || !await appendProven(db, 'payroll_hollow_policy_revisions', row, revision.createdBy, result.logIds))
        return false
      const own = await db.select<Row>('SELECT * FROM payroll_hollow_policy_revisions WHERE command_id=?', [revision.commandId])
      if (!same(own.map(row => row.id).sort(), result.policyRevisionIds.slice().sort()))
        return false
      for (const sibling of own) {
        const original = parsed(sibling.revision_json)
        if (!isPayrollHollowPolicyRevision(original) || original.id !== sibling.id || original.commandId !== command.commandId || original.createdBy !== command.actorId || !await appendProven(db, 'payroll_hollow_policy_revisions', sibling, command.actorId, result.logIds))
          return false
      }
    }
    return true
  }
  catch {
    return false
  }
}
