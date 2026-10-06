import type { CrewWorkerCommandResultDTO } from '../../app/lib/crew-worker/command-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CrewFormDraft, WorkerFormDraft } from '../../app/lib/master-data/forms'
import type { BusinessSession } from './business-session'
import type { CrewWorkerCommandState, CrewWorkerStored } from './crew-worker-command-service'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { CREW_PAYROLL_FEE_FIELDS } from '../../app/lib/crew-worker/payroll-fee-defaults'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/read-contract'
import { isISODateTimeDTO } from '../../app/types/read-model'
import { commandJournalKey } from './command-journal'
import { parseCrewCommandRequest, parseWorkerCommandRequest } from './crew-worker-command-request'

export function productionCrewWorkerFailure(code: 'forbidden' | 'unavailable' | 'conflict' | 'validation-failed', message: string): never {
  throw new CrewWorkerRepositoryProblem(crewWorkerProblem(code, message))
}
export function decodeProductionCrewWorkerRecord<T extends CrewFormDraft | WorkerFormDraft>(kind: 'crew' | 'worker', id: string, json: string, actor: BusinessSession): CrewWorkerStored<T> {
  try {
    const record = JSON.parse(json) as CrewWorkerStored<T>
    if (!record || Object.keys(record).some(key => !['id', 'draft', 'version', 'updatedAt', 'deletedAt', 'migrationBatchId', 'payrollFeeDefaults', 'linkedWorkerId'].includes(key))
      || record.id !== id || !record.draft || (record.draft.id !== undefined && record.draft.id !== id) || !Number.isSafeInteger(record.version) || record.version < 1 || !isISODateTimeDTO(record.updatedAt)
      || (record.deletedAt !== undefined && record.deletedAt !== null && (typeof record.deletedAt !== 'string' || !Number.isFinite(Date.parse(record.deletedAt))))
      || (record.migrationBatchId !== undefined && record.migrationBatchId !== null && typeof record.migrationBatchId !== 'string')
      || (record.linkedWorkerId !== undefined && record.linkedWorkerId !== null && (kind !== 'worker' || typeof record.linkedWorkerId !== 'string' || !record.linkedWorkerId.trim()))) {
      throw new Error('invalid record')
    }
    if (record.payrollFeeDefaults !== undefined) {
      if (kind !== 'crew' || !record.payrollFeeDefaults || Object.keys(record.payrollFeeDefaults).sort().join(',') !== CREW_PAYROLL_FEE_FIELDS.map(field => field.fact).sort().join(','))
        throw new Error('invalid fee facts')
      for (const field of CREW_PAYROLL_FEE_FIELDS) {
        const fact = record.payrollFeeDefaults[field.fact]
        if (!fact || (fact.state === 'missing' ? Object.keys(fact).length !== 1 : fact.state === 'null' ? Object.keys(fact).length !== 2 || fact.value !== null : fact.state === 'value' ? Object.keys(fact).length !== 2 || (field.kind === 'boolean' ? typeof fact.value !== 'boolean' : typeof fact.value !== 'number' || !Number.isFinite(fact.value) || fact.value < 0) : true))
          throw new Error('invalid fee fact')
      }
    }
    const envelope = { id, workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: `${kind}:write`, commandId: 'validate-frozen-record', baseVersion: String(record.version), action: 'draft', draft: record.draft, attachments: {} }
    if (kind === 'crew')
      parseCrewCommandRequest(envelope, id)
    else
      parseWorkerCommandRequest(envelope, id)
    return record
  }
  catch { return productionCrewWorkerFailure('unavailable', '正式班组或工人记录身份、版本或字段证据损坏。') }
}
export async function loadProductionCrewWorkers(tx: TransactionDb, actor: BusinessSession): Promise<CrewWorkerCommandState> {
  const [stamp] = await tx.select<{ revision: number }>('SELECT revision FROM crew_worker_revision WHERE singleton=1')
  if (!stamp || !Number.isSafeInteger(stamp.revision) || stamp.revision < 0)
    productionCrewWorkerFailure('unavailable', '正式工人目录来源版本缺失。')
  const state: CrewWorkerCommandState = { sourceVersion: stamp.revision, commands: new Map(), commandFingerprints: new Map(), sealedCommands: new Set(), crews: new Map(), workers: new Map() }
  for (const kind of ['crew', 'worker'] as const) {
    const table = kind === 'crew' ? 'crews' : 'workers'
    const records = await tx.select<{ id: string, record_json: string }>(`SELECT id,record_json FROM ${table} ORDER BY id`)
    for (const row of records) {
      const record = decodeProductionCrewWorkerRecord(kind, row.id, row.record_json, actor)
      if (kind === 'crew')
        state.crews.set(row.id, record as CrewWorkerStored<CrewFormDraft>)
      else
        state.workers.set(row.id, record as CrewWorkerStored<WorkerFormDraft>)
    }
  }
  const receipts = await tx.select<{ workspace_id: string, actor_id: string, kind: string, command_id: string, entity_id: string, fingerprint: string, result_json: string }>('SELECT * FROM crew_worker_command_receipts ORDER BY workspace_id,actor_id,kind,command_id')
  for (const row of receipts) {
    let result: CrewWorkerCommandResultDTO
    try {
      result = JSON.parse(row.result_json)
    }
    catch { return productionCrewWorkerFailure('unavailable', '正式工人原命令回执损坏。') }
    const current = row.kind === 'crew' ? state.crews.get(row.entity_id) : row.kind === 'worker' ? state.workers.get(row.entity_id) : null
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || !current || !/^[a-f0-9]{64}$/.test(row.fingerprint)
      || result.id !== row.entity_id || result.commandId !== row.command_id || !/^[1-9]\d*$/.test(result.version) || BigInt(result.version) > BigInt(current.version)
      || !isISODateTimeDTO(result.updatedAt) || !Array.isArray(result.attachmentIds) || result.attachmentIds.length) {
      productionCrewWorkerFailure('unavailable', '正式工人原命令身份、目标或版本证据不一致。')
    }
    const key = commandJournalKey(row.command_id, actor, row.kind)
    state.commands.set(key, result)
    state.commandFingerprints.set(key, row.fingerprint)
  }
  for (const row of await tx.select<{ workspace_id: string, actor_id: string, kind: string, command_id: string }>('SELECT * FROM crew_worker_command_resolutions')) {
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || !['crew', 'worker'].includes(row.kind))
      productionCrewWorkerFailure('unavailable', '正式工人原编号封存来源不一致。')
    const key = commandJournalKey(row.command_id, actor, row.kind)
    if (state.commands.has(key))
      productionCrewWorkerFailure('unavailable', '正式工人同一原编号同时存在回执和未应用封存。')
    state.sealedCommands.add(key)
  }
  return state
}

export async function saveProductionCrewWorkers(tx: TransactionDb, after: CrewWorkerCommandState, before: CrewWorkerCommandState, actor: BusinessSession, timestamp: string) {
  for (const kind of ['crew', 'worker'] as const) {
    const table = kind === 'crew' ? 'crews' : 'workers'
    const next = kind === 'crew' ? after.crews : after.workers
    const previous = kind === 'crew' ? before.crews : before.workers
    for (const id of previous.keys()) {
      if (!next.has(id))
        productionCrewWorkerFailure('conflict', '正式目录身份已有历史证据，不能通过迁入删除。')
    }
    for (const [id, record] of next) {
      const prior = previous.get(id)
      if (isDeepStrictEqual(prior, record))
        continue
      if (prior)
        await tx.execute(`UPDATE ${table} SET record_json=? WHERE id=?`, [JSON.stringify(record), id])
      else
        await tx.execute(`INSERT INTO ${table}(id,record_json) VALUES (?,?)`, [id, JSON.stringify(record)])
      const journal = [...after.commands.entries()].find(([key, result]) => !before.commands.has(key) && result.id === id && JSON.parse(key)[2] === kind)
      if (!journal)
        productionCrewWorkerFailure('unavailable', '正式目录写入缺少同事务的原命令证据。')
      await tx.execute('INSERT INTO crew_worker_audits(id,kind,entity_id,actor_id,command_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)', [`crew-audit-${randomUUID()}`, kind, id, actor.actorId, journal[1].commandId, prior ? JSON.stringify(prior) : null, JSON.stringify(record), timestamp])
    }
  }
  for (const [key, result] of after.commands) {
    if (before.commands.has(key)) {
      if (!isDeepStrictEqual(before.commands.get(key), result) || before.commandFingerprints.get(key) !== after.commandFingerprints.get(key))
        productionCrewWorkerFailure('unavailable', '原工人回执或指纹不能覆盖。')
      continue
    }
    const [workspaceId, actorId, kind, commandId] = JSON.parse(key)
    await tx.execute('INSERT INTO crew_worker_command_receipts(workspace_id,actor_id,kind,command_id,entity_id,fingerprint,result_json,created_at) VALUES (?,?,?,?,?,?,?,?)', [workspaceId, actorId, kind, commandId, result.id, after.commandFingerprints.get(key), JSON.stringify(result), timestamp])
  }
  for (const key of after.sealedCommands) {
    if (before.sealedCommands.has(key))
      continue
    const [workspaceId, actorId, kind, commandId] = JSON.parse(key)
    await tx.execute('INSERT INTO crew_worker_command_resolutions(workspace_id,actor_id,kind,command_id,resolved_at) VALUES (?,?,?,?,?)', [workspaceId, actorId, kind, commandId, timestamp])
  }
  await tx.execute('UPDATE crew_worker_revision SET revision=? WHERE singleton=1', [after.sourceVersion])
}
