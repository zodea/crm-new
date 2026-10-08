import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityContext, QuantityReadQuery, QuantityUnitReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityHollowCommand, QuantityHollowCommandResult } from '../../app/lib/quantity/central-hollow-contract'
import type { QuantityHollowLogPayload, QuantityHollowProofOptions } from '../../app/lib/quantity/central-hollow-proof-contract'
import type { QuantityHollowRow, QuantityHollowTable } from '../../app/lib/quantity/central-hollow-schema'
import type { QuantityPersonSource } from '../../app/lib/quantity/central-people'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { hollowCanonical, hollowEqual, hollowHash, hollowId, hollowJson } from '../../app/lib/quantity/central-hollow-primitives'
import { quantityHollowProofFingerprint } from '../../app/lib/quantity/central-hollow-proof'
import { decodeQuantityHollowCommand } from '../../app/lib/quantity/central-hollow-result'
import { initializeQuantityHollowSchema, QUANTITY_HOLLOW_COLUMNS } from '../../app/lib/quantity/central-hollow-schema'
import { parseQuantityHollowCommand } from '../../app/lib/quantity/central-hollow-validation'
import { synchronizeQuantityPeople } from '../../app/lib/quantity/central-people'
import { generateId } from '../../app/lib/util/id'
import { loadQuantityHollowHistories } from './quantity-hollow-facts'
import { loadQuantityHollowWorkspace, readQuantityHollowVersion } from './quantity-hollow-read'
import { loadQuantityHollowTargets } from './quantity-hollow-targets'

export interface QuantityHollowProject { id: string, name: string, code: string, dataOrigin: 'real' | 'demo' }
export interface QuantityHollowServiceOptions extends QuantityHollowProofOptions {
  session: (sessionId?: string | null) => QuantityContext
  projects: (sessionId?: string | null) => readonly QuantityHollowProject[] | Promise<readonly QuantityHollowProject[]>
  people: (sessionId?: string | null) => readonly QuantityPersonSource[] | Promise<readonly QuantityPersonSource[]>
  authoritativeMasters?: boolean
  transaction: <T>(work: (tx: TransactionDb, context: QuantityContext) => Promise<T>, sessionId?: string | null) => Promise<T>
}
function requireContext(context: QuantityContext, write: boolean) {
  const required = ['quantity:read', 'project:list:read', 'crew:list:read', 'worker:list:read', ...(write ? ['quantity:write'] : [])]
  if (!hollowId(context.workspaceId) || !hollowId(context.actorId) || required.some(capability => !context.capabilities.includes(capability)))
    throw quantityProblem('forbidden', '当前身份无权读取或修改空鼓原施工责任')
}
function sameContext(left: QuantityContext, right: QuantityContext): boolean {
  return left.workspaceId === right.workspaceId && left.actorId === right.actorId && hollowEqual([...left.capabilities].sort(), [...right.capabilities].sort())
}
async function insert(tx: TransactionDb, table: QuantityHollowTable, row: QuantityHollowRow) {
  const columns = QUANTITY_HOLLOW_COLUMNS[table]
  await tx.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
}

/** 三个新增来源动作拥有持久回执；沿现有工作区事务，不另开队列。 */
export function createQuantityHollowService(options: QuantityHollowServiceOptions) {
  async function run<T>(query: QuantityReadQuery, sessionId: string | null | undefined, write: boolean, work: (tx: TransactionDb, context: QuantityContext) => Promise<T>): Promise<T> {
    const scheduled = structuredClone(options.session(sessionId))
    requireContext(scheduled, write)
    if (query.origin !== 'real' || !hollowId(query.projectId))
      throw quantityProblem('invalid-query', '空鼓来源必须指定正式项目')
    return options.transaction(async (tx, transactionContext) => {
      const context = structuredClone(options.session(sessionId))
      requireContext(context, write)
      if (!sameContext(scheduled, context) || !sameContext(transactionContext, context))
        throw quantityProblem('forbidden', '等待期间工作区、经办身份或权限已变化')
      const projects = structuredClone(await options.projects(sessionId))
      const project = projects.find(row => row.id === query.projectId && row.dataOrigin === 'real')
      if (!project)
        throw quantityProblem('not-found', '当前可读项目中没有所选空鼓项目')
      const people = structuredClone(await options.people(sessionId))
      await initializeQuantityHollowSchema(tx)
      if (!options.authoritativeMasters) {
        await tx.execute('INSERT INTO projects(id,name,code) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code,deleted_at=NULL', [project.id, project.name, project.code])
        await synchronizeQuantityPeople(tx, context, async () => people)
      }
      const result = await work(tx, context)
      const currentProject = (await options.projects(sessionId)).find(row => row.id === query.projectId && row.dataOrigin === 'real')
      if (!hollowEqual(project, currentProject ?? null) || !hollowEqual(people, await options.people(sessionId)))
        throw quantityProblem('stale-source', '读取期间项目或原责任资格已变化，请重新核对')
      const latest = options.session(sessionId)
      requireContext(latest, write)
      if (!sameContext(context, latest))
        throw quantityProblem('forbidden', '提交前工作区、经办身份或权限已变化')
      return result
    }, sessionId)
  }
  return {
    hollow(query: QuantityUnitReadQuery, sessionId?: string | null) {
      const scope = structuredClone(query)
      if (!hollowId(scope.unitId))
        throw quantityProblem('invalid-query', '空鼓读取必须指定原户')
      return run(scope, sessionId, false, (tx, context) => loadQuantityHollowWorkspace(tx, scope, context, options))
    },
    executeHollow(input: QuantityHollowCommand, sessionId?: string | null) {
      const command = parseQuantityHollowCommand(input)
      return run({ projectId: command.projectId, origin: command.origin, includeDemo: false }, sessionId, true, async (tx, context): Promise<QuantityHollowCommandResult> => {
        if (command.actorId !== context.actorId || command.workspaceId !== context.workspaceId)
          throw quantityProblem('forbidden', '空鼓命令不属于当前工作区和经办身份')
        const [cached] = await tx.select<QuantityHollowRow>('SELECT * FROM quantity_hollow_command_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [context.workspaceId, context.actorId, command.commandId])
        if (cached) {
          const imported = await options.migratedProof?.(tx, command.projectId)
          if (imported?.unavailable.some(row => row.recordId === cached.record_id) || imported?.histories.get(String(cached.record_id))?.steps.some(step => step.receiptId === cached.id))
            throw quantityProblem('conflict', '迁入原来源命令仅供历史核对，不能由当前命令领取或重放')
          if (!hollowEqual(hollowJson(cached.request_json), command) || await hollowHash(String(cached.request_json)) !== cached.request_fingerprint)
            throw quantityProblem('conflict', '同一空鼓命令键已用于其他正文，请核对原提交')
          const loaded = await loadQuantityHollowHistories(tx, command.projectId, options)
          const step = loaded.histories.get(String(cached.record_id))?.steps.find(row => row.receiptId === cached.id)
          if (!step)
            throw quantityProblem('unavailable', '原空鼓回执或其来源前缀无法证明')
          return decodeQuantityHollowCommand(hollowJson(cached.result_json), command)
        }
        const action = command.action
        const [original] = action.kind === 'create-hollow-inspection' ? [] : await tx.select<QuantityHollowRow>('SELECT * FROM quantity_hollow_records WHERE id=? AND project_id=?', [action.recordId, command.projectId])
        if (action.kind !== 'create-hollow-inspection' && !original)
          throw quantityProblem('not-found', '原空鼓检查不属于当前项目或已经缺失')
        const unitId = action.kind === 'create-hollow-inspection' ? action.target.unitId : String(original!.unit_id)
        const scope = { projectId: command.projectId, unitId, origin: 'real' as const, includeDemo: false }
        const before = await loadQuantityHollowWorkspace(tx, scope, context, options)
        if (command.baseVersion !== before.sourceVersion)
          throw quantityProblem('stale-source', '检查或整改来源已变化，请保留输入重新核对')
        const record = action.kind === 'create-hollow-inspection' ? null : before.data.records.find(row => row.recordId === action.recordId)
        if (action.kind !== 'create-hollow-inspection' && (!record || record.inspection.revisionId !== action.expectedRevisionId))
          throw quantityProblem('stale-source', '原检查修订已变化或不能证明')
        const targets = action.kind === 'create-hollow-inspection' ? await loadQuantityHollowTargets(tx, command.projectId, unitId) : null
        const responsibility = action.kind === 'create-hollow-inspection' ? targets?.proofs.find(proof => hollowEqual(proof.target, action.target)) : null
        if (action.kind === 'create-hollow-inspection' && !responsibility)
          throw quantityProblem('relationship-mismatch', '所选原责任或房间分项不属于当前可证明范围')
        if (action.kind === 'rectify-hollow-inspection' && (action.count > record!.remainingCount || action.rectifiedOn < record!.inspection.input.inspectedOn))
          throw quantityProblem('validation-failed', '整改数量超过未整改余量，或整改日早于检查日')
        if (action.kind === 'revise-hollow-inspection' && (action.input.count < record!.rectifiedCount || record!.rectifications.some(event => event.rectifiedOn < action.input.inspectedOn)))
          throw quantityProblem('validation-failed', '修订总发现数不能低于已整改数，检查日不能晚于已有整改日')
        const recordId = record?.recordId ?? generateId('qty_hollow')
        const revisionId = action.kind === 'rectify-hollow-inspection' ? record!.inspection.revisionId : generateId('qty_hollow_rev')
        const eventId = action.kind === 'rectify-hollow-inspection' ? generateId('qty_hollow_fix') : null
        const logId = generateId('qty_hollow_log')
        const receiptId = generateId('qty_hollow_receipt')
        const createdAt = new Date().toISOString()
        const responsibilityJson = responsibility ? hollowCanonical(responsibility) : String(original!.responsibility_proof_json)
        const responsibilityFingerprint = responsibility ? await hollowHash(responsibilityJson) : String(original!.responsibility_fingerprint)
        const body: QuantityHollowLogPayload = { schemaVersion: 1, recordId, previousLogId: record?.proof.headLogId ?? null, action, revisionId, rectificationId: eventId, actorId: context.actorId, createdAt }
        const rawPayload = hollowCanonical(body)
        const payloadFingerprint = await hollowHash(rawPayload)
        const proof = { recordId, revisionId, headLogId: logId, rectificationIds: [...(record?.proof.rectificationIds ?? []), ...(eventId ? [eventId] : [])], fingerprint: await quantityHollowProofFingerprint(responsibilityFingerprint, record?.proof.fingerprint ?? null, payloadFingerprint) }
        if (responsibility)
          await insert(tx, 'quantity_hollow_records', { id: recordId, project_id: command.projectId, unit_id: unitId, assignment_id: responsibility.target.assignmentId, room_id: responsibility.target.roomId, item_id: responsibility.target.itemId, ownership_key: responsibility.ownershipKey, original_party_json: hollowCanonical(responsibility.originalParty), location_json: hollowCanonical(responsibility.location), responsibility_proof_json: responsibilityJson, responsibility_fingerprint: responsibilityFingerprint, created_at: createdAt, created_by: context.actorId, command_receipt_id: receiptId })
        if (action.kind === 'rectify-hollow-inspection')
          await insert(tx, 'quantity_hollow_rectifications', { id: eventId!, record_id: recordId, revision_id: revisionId, rectified_on: action.rectifiedOn, count: action.count, note: action.note, created_at: createdAt, created_by: context.actorId, command_receipt_id: receiptId })
        else await insert(tx, 'quantity_hollow_revisions', { id: revisionId, record_id: recordId, previous_revision_id: record?.inspection.revisionId ?? null, inspected_on: action.input.inspectedOn, count: action.input.count, note: action.input.note, reason: action.kind === 'revise-hollow-inspection' ? action.reason : null, created_at: createdAt, created_by: context.actorId, command_receipt_id: receiptId })
        await insert(tx, 'quantity_hollow_logs', { id: logId, project_id: command.projectId, record_id: recordId, previous_log_id: body.previousLogId, kind: action.kind, revision_id: revisionId, rectification_id: eventId, payload_json: rawPayload, payload_fingerprint: payloadFingerprint, created_at: createdAt, actor_id: context.actorId, command_receipt_id: receiptId })
        const requestJson = hollowCanonical(command)
        // 结果含提交后版本；仅本事务内暂置空结果，再在提交前完整签入并回读。
        await insert(tx, 'quantity_hollow_command_receipts', { id: receiptId, workspace_id: context.workspaceId, actor_id: context.actorId, command_id: command.commandId, project_id: command.projectId, unit_id: unitId, record_id: recordId, kind: action.kind, request_json: requestJson, request_fingerprint: await hollowHash(requestJson), result_json: '{}', result_fingerprint: '', created_at: createdAt })
        const result: QuantityHollowCommandResult = { commandId: command.commandId, id: recordId, logIds: [logId], sourceVersion: await readQuantityHollowVersion(tx, scope), hollow: { kind: action.kind, recordId, unitId, revisionId, rectificationId: eventId, logId, proof } }
        const resultJson = hollowCanonical(result)
        await tx.execute('UPDATE quantity_hollow_command_receipts SET result_json=?,result_fingerprint=? WHERE id=? AND result_json=\'{}\' AND result_fingerprint=\'\'', [resultJson, await hollowHash(resultJson), receiptId])
        const confirmed = await loadQuantityHollowHistories(tx, command.projectId, options)
        if (!confirmed.histories.get(recordId)?.steps.some(step => step.receiptId === receiptId && hollowEqual(step.result, result)))
          throw quantityProblem('internal-error', '空鼓写入后的完整原件未通过核验，已取消本次保存')
        return result
      })
    },
  }
}
