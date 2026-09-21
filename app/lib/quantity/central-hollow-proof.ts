import type { QuantityHollowFact, QuantityHollowProofRef, QuantityHollowRectification, QuantityHollowRevision } from './central-hollow-contract'
import type { QuantityHollowLogPayload, QuantityHollowProofInput, QuantityHollowProofResult, QuantityHollowProvenHistory, QuantityHollowResponsibilityProof } from './central-hollow-proof-contract'
import type { QuantityHollowRow, QuantityHollowTables } from './central-hollow-schema'
import { isISODateTimeDTO } from '../../types/read-model'
import { hollowCount, hollowEqual, hollowHash, hollowId, hollowInvalid, hollowJson, hollowKeys } from './central-hollow-primitives'
import { parseQuantityHollowResponsibility } from './central-hollow-responsibility'
import { decodeQuantityHollowCommand } from './central-hollow-result'
import { QUANTITY_HOLLOW_COLUMNS, QUANTITY_HOLLOW_TABLES } from './central-hollow-schema'
import { parseQuantityHollowAction, parseQuantityHollowCommand } from './central-hollow-validation'

export type * from './central-hollow-proof-contract'

export function parseQuantityHollowTables(value: unknown): QuantityHollowTables {
  if (!hollowKeys(value, QUANTITY_HOLLOW_TABLES))
    return hollowInvalid('空鼓五表结构不完整')
  for (const table of QUANTITY_HOLLOW_TABLES) {
    const rows = value[table]
    if (!Array.isArray(rows) || rows.some(row => !hollowKeys(row, QUANTITY_HOLLOW_COLUMNS[table]) || !hollowId(row.id) || Object.values(row).some(field => field !== null && typeof field !== 'string' && (typeof field !== 'number' || !Number.isFinite(field)))) || new Set(rows.map(row => row.id)).size !== rows.length)
      return hollowInvalid('空鼓原件行字段或稳定身份无效')
  }
  return value as unknown as QuantityHollowTables
}
export async function quantityHollowProofFingerprint(responsibilityFingerprint: string, previous: string | null, payloadFingerprint: string): Promise<string> {
  return hollowHash(JSON.stringify(['quantity-hollow-proof-v1', responsibilityFingerprint, previous, payloadFingerprint]))
}

function failed(recordId: string, cause: unknown): QuantityHollowProofResult {
  return { status: 'unproven', diagnostics: [{ code: 'record-unproven', message: cause instanceof Error ? cause.message : '空鼓原件不可证明', recordId, target: null }] }
}
function payload(raw: unknown): QuantityHollowLogPayload {
  const value = hollowJson(raw)
  if (!hollowKeys(value, ['schemaVersion', 'recordId', 'previousLogId', 'action', 'revisionId', 'rectificationId', 'actorId', 'createdAt']) || value.schemaVersion !== 1 || !hollowId(value.recordId) || !(value.previousLogId === null || hollowId(value.previousLogId)) || !hollowId(value.revisionId) || !(value.rectificationId === null || hollowId(value.rectificationId)) || !hollowId(value.actorId) || !isISODateTimeDTO(value.createdAt))
    return hollowInvalid('空鼓日志正文或经办时间无效')
  return { ...value, action: parseQuantityHollowAction(value.action) } as QuantityHollowLogPayload
}
function only(rows: QuantityHollowRow[], id: unknown, label: string): QuantityHollowRow {
  const found = rows.filter(row => row.id === id)
  if (found.length !== 1)
    return hollowInvalid(`${label}原行缺失或重复`)
  return found[0]!
}
function personName(proof: QuantityHollowResponsibilityProof): string {
  return String(proof.rows[proof.originalParty.kind === 'worker' ? 'workers' : 'crews'][0]!.name)
}

async function append(prefix: QuantityHollowProvenHistory | null, projectId: string, recordId: string, responsibility: QuantityHollowResponsibilityProof, responsibilityFingerprint: string, tables: QuantityHollowTables, root?: QuantityHollowRow): Promise<QuantityHollowProvenHistory> {
  const rows = {
    revisions: tables.quantity_hollow_revisions.filter(row => row.record_id === recordId),
    rectifications: tables.quantity_hollow_rectifications.filter(row => row.record_id === recordId),
    logs: tables.quantity_hollow_logs.filter(row => row.record_id === recordId),
    receipts: tables.quantity_hollow_command_receipts.filter(row => row.record_id === recordId),
  }
  const revisions: QuantityHollowRevision[] = structuredClone(prefix?.fact.revisions ?? [])
  const rectifications: QuantityHollowRectification[] = structuredClone(prefix?.fact.rectifications ?? [])
  const steps = structuredClone(prefix?.steps ?? [])
  const remaining = new Map(rows.logs.map(row => [String(row.id), row]))
  const seenRevisions = new Set<string>()
  const seenRectifications = new Set<string>()
  const seenReceipts = new Set<string>()
  let previousLog = prefix?.fact.proof.headLogId ?? null
  let previousFingerprint = prefix?.fact.proof.fingerprint ?? null
  if (!remaining.size && !prefix)
    return hollowInvalid('原检查缺少创建日志')
  if (rows.logs.some(row => prefix?.steps.some(step => step.logId === row.id)) || rows.revisions.some(row => revisions.some(revision => revision.revisionId === row.id)) || rows.rectifications.some(row => rectifications.some(event => event.id === row.id)))
    return hollowInvalid('空鼓后缀重复包含已证前缀')
  while (remaining.size) {
    const next = [...remaining.values()].filter(row => row.previous_log_id === previousLog)
    if (next.length !== 1)
      return hollowInvalid('空鼓日志前驱断裂或存在分叉')
    const log = next[0]!
    const body = payload(log.payload_json)
    const receipt = only(rows.receipts, log.command_receipt_id, '空鼓命令回执')
    const command = parseQuantityHollowCommand(hollowJson(receipt.request_json))
    const result = decodeQuantityHollowCommand(hollowJson(receipt.result_json), command)
    if (await hollowHash(String(log.payload_json)) !== log.payload_fingerprint || await hollowHash(String(receipt.request_json)) !== receipt.request_fingerprint || await hollowHash(String(receipt.result_json)) !== receipt.result_fingerprint)
      return hollowInvalid('空鼓原日志或回执摘要不一致')
    if (seenReceipts.has(String(receipt.id)) || receipt.workspace_id !== command.workspaceId || receipt.actor_id !== command.actorId || receipt.command_id !== command.commandId || receipt.project_id !== projectId || receipt.unit_id !== responsibility.target.unitId || receipt.kind !== command.action.kind || log.project_id !== projectId || body.recordId !== recordId || body.previousLogId !== previousLog || body.actorId !== command.actorId || log.actor_id !== command.actorId || log.kind !== command.action.kind || log.revision_id !== body.revisionId || log.rectification_id !== body.rectificationId || log.created_at !== body.createdAt || receipt.created_at !== body.createdAt || !hollowEqual(command.action, body.action) || command.projectId !== projectId)
      return hollowInvalid('空鼓原日志、命令与实体身份不一致')
    const current = revisions.at(-1)
    const fixed = rectifications.reduce((sum, event) => sum + event.count, 0)
    const action = body.action
    if (action.kind === 'rectify-hollow-inspection') {
      if (!current || action.recordId !== recordId || action.expectedRevisionId !== current.revisionId || body.revisionId !== current.revisionId || !hollowId(body.rectificationId) || action.rectifiedOn < current.input.inspectedOn || action.count > current.input.count - fixed)
        return hollowInvalid('整改所核版本、日期或处数超过当时余量')
      const event = only(rows.rectifications, body.rectificationId, '整改')
      if (event.revision_id !== current.revisionId || event.rectified_on !== action.rectifiedOn || event.count !== action.count || event.note !== action.note || event.created_at !== body.createdAt || event.created_by !== command.actorId || event.command_receipt_id !== receipt.id || seenRectifications.has(String(event.id)))
        return hollowInvalid('整改原行与原命令不一致')
      rectifications.push({ id: String(event.id), revisionId: current.revisionId, rectifiedOn: action.rectifiedOn, count: action.count, note: action.note, commandId: command.commandId, logId: String(log.id), actorId: command.actorId, createdAt: body.createdAt })
      seenRectifications.add(String(event.id))
    }
    else {
      if (body.rectificationId !== null || (action.kind === 'create-hollow-inspection' ? !!current || !!prefix || !hollowEqual(action.target, responsibility.target) : !current || action.recordId !== recordId || action.expectedRevisionId !== current.revisionId) || action.input.count < fixed || rectifications.some(event => event.rectifiedOn < action.input.inspectedOn))
        return hollowInvalid('原检查创建或修订的因果版本、日期或数量不成立')
      const revision = only(rows.revisions, body.revisionId, '检查修订')
      const reason = action.kind === 'revise-hollow-inspection' ? action.reason : null
      if (revision.previous_revision_id !== (current?.revisionId ?? null) || revision.inspected_on !== action.input.inspectedOn || revision.count !== action.input.count || revision.note !== action.input.note || revision.reason !== reason || revision.created_at !== body.createdAt || revision.created_by !== command.actorId || revision.command_receipt_id !== receipt.id || seenRevisions.has(String(revision.id)))
        return hollowInvalid('原检查修订行与原命令不一致')
      if (!current && (!root || root.command_receipt_id !== receipt.id || root.created_at !== body.createdAt || root.created_by !== command.actorId))
        return hollowInvalid('检查创建原根与回执不一致')
      revisions.push({ revisionId: String(revision.id), previousRevisionId: current?.revisionId ?? null, input: structuredClone(action.input), reason, commandId: command.commandId, logId: String(log.id), actorId: command.actorId, createdAt: body.createdAt })
      seenRevisions.add(String(revision.id))
    }
    const latest = revisions.at(-1)!
    const fingerprint = await quantityHollowProofFingerprint(responsibilityFingerprint, previousFingerprint, String(log.payload_fingerprint))
    const proof: QuantityHollowProofRef = { recordId, revisionId: latest.revisionId, headLogId: String(log.id), rectificationIds: rectifications.map(event => event.id), fingerprint }
    if (result.id !== recordId || result.hollow.unitId !== responsibility.target.unitId || result.hollow.logId !== log.id || result.hollow.rectificationId !== body.rectificationId || !hollowEqual(result.hollow.proof, proof))
      return hollowInvalid('空鼓原回执未签入准确事件前缀')
    steps.push({ logId: String(log.id), receiptId: String(receipt.id), payload: body, payloadFingerprint: String(log.payload_fingerprint), command, result, proof })
    seenReceipts.add(String(receipt.id))
    previousLog = String(log.id)
    previousFingerprint = fingerprint
    remaining.delete(String(log.id))
  }
  if (seenRevisions.size !== rows.revisions.length || seenRectifications.size !== rows.rectifications.length || seenReceipts.size !== rows.receipts.length)
    return hollowInvalid('空鼓原件包含没有签入命令的额外修订、整改或回执')
  const inspection = revisions.at(-1)!
  const rectifiedCount = rectifications.reduce((sum, event) => sum + event.count, 0)
  if (!inspection || !hollowCount(rectifiedCount) || !hollowCount(inspection.input.count - rectifiedCount))
    return hollowInvalid('原检查数量或整改余量不能完整证明')
  const fact: QuantityHollowFact = { recordId, target: responsibility.target, originalParty: responsibility.originalParty, originalPartyName: personName(responsibility), ownershipKey: responsibility.ownershipKey, location: responsibility.location, inspection, revisions, rectifications, rectifiedCount, remainingCount: inspection.input.count - rectifiedCount, proof: steps.at(-1)!.proof }
  return { projectId, recordId, responsibilityFingerprint, responsibility, fact, steps }
}

export async function proveQuantityHollowRecord(input: QuantityHollowProofInput): Promise<QuantityHollowProofResult> {
  try {
    const tables = parseQuantityHollowTables(input.tables)
    const root = only(tables.quantity_hollow_records, input.recordId, '检查')
    const responsibility = parseQuantityHollowResponsibility(hollowJson(root.responsibility_proof_json))
    if (root.project_id !== input.projectId || responsibility.location.projectId !== input.projectId || root.unit_id !== responsibility.target.unitId || root.assignment_id !== responsibility.target.assignmentId || root.room_id !== responsibility.target.roomId || root.item_id !== responsibility.target.itemId || root.ownership_key !== responsibility.ownershipKey || !hollowEqual(hollowJson(root.original_party_json), responsibility.originalParty) || !hollowEqual(hollowJson(root.location_json), responsibility.location) || await hollowHash(String(root.responsibility_proof_json)) !== root.responsibility_fingerprint)
      return hollowInvalid('检查根与首次原责任证明不一致')
    return { status: 'proven', history: await append(null, input.projectId, input.recordId, responsibility, String(root.responsibility_fingerprint), tables, root) }
  }
  catch (cause) { return failed(input.recordId, cause) }
}
export async function extendQuantityHollowProvenHistory(prefix: QuantityHollowProvenHistory, nativeTables: QuantityHollowTables): Promise<QuantityHollowProofResult> {
  try {
    const tables = parseQuantityHollowTables(nativeTables)
    if (tables.quantity_hollow_records.length || prefix.fact.proof.fingerprint !== prefix.steps.at(-1)?.proof.fingerprint)
      return hollowInvalid('后续原件不能重建检查根或替换原端点')
    return { status: 'proven', history: await append(prefix, prefix.projectId, prefix.recordId, prefix.responsibility, prefix.responsibilityFingerprint, tables) }
  }
  catch (cause) { return failed(prefix.recordId, cause) }
}

/** 只从已经逐事件证明的历史取端点；不能用当前值替代冻结引用。 */
export function quantityHollowFrozenFact(history: QuantityHollowProvenHistory, ref: QuantityHollowProofRef): QuantityHollowFact | null {
  const end = history.steps.findIndex(step => hollowEqual(step.proof, ref))
  if (end < 0)
    return null
  const logs = new Set(history.steps.slice(0, end + 1).map(step => step.logId))
  const revisions = history.fact.revisions.filter(row => logs.has(row.logId))
  const rectifications = history.fact.rectifications.filter(row => logs.has(row.logId))
  const inspection = revisions.at(-1)!
  const rectifiedCount = rectifications.reduce((sum, row) => sum + row.count, 0)
  return structuredClone({ ...history.fact, inspection, revisions, rectifications, rectifiedCount, remainingCount: inspection.input.count - rectifiedCount, proof: ref })
}
