import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/read-contract'

function fail(code: 'forbidden' | 'unavailable', message: string): never {
  throw new CrewWorkerRepositoryProblem(crewWorkerProblem(code, message))
}
async function authorize(tx: TransactionDb, actor: BusinessSession) {
  if (!actor.capabilities.includes('worker:list:read'))
    fail('forbidden', '当前身份无权读取全局工人目录。')
  const identity = (await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  if (!identity || identity.workspace_id !== actor.workspaceId || identity.owner_id !== actor.actorId)
    fail('forbidden', '工人目录来源与当前工作区或身份不一致。')
  const participant = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', ['crew-worker']))[0]
  if (participant?.schema_version !== 1)
    fail('unavailable', '正式全局工人来源尚未接通；不能借用开发目录或按姓名匹配。')
}
function reference(row: { id: string, record_json: string }): { id: string, name: string, deleted_at: null } | null {
  let record: { id?: unknown, deletedAt?: unknown, draft?: { name?: unknown } }
  try {
    record = JSON.parse(row.record_json)
  }
  catch { return fail('unavailable', '正式工人原记录损坏，请核对原来源。') }
  if (!record || record.id !== row.id || !record.draft || (record.draft.name !== undefined && typeof record.draft.name !== 'string'))
    fail('unavailable', '正式工人稳定身份或姓名来源无法核实。')
  if (record.deletedAt || !record.draft.name?.trim())
    return null
  return { id: row.id, name: record.draft.name, deleted_at: null }
}
/** Same production transaction and owner; no project filter and no private draft fields. */
export async function readWorkerReference(tx: TransactionDb, actor: BusinessSession, id: string) {
  await authorize(tx, actor)
  if (!/^[A-Z0-9][\w-]{2,79}$/i.test(id))
    fail('unavailable', '工人稳定身份无效。')
  const row = (await tx.select<{ id: string, record_json: string }>('SELECT id,record_json FROM workers WHERE id=?', [id]))[0]
  return row ? reference(row) : null
}
/** Returns every authorized global worker exactly once by stable ID, including cross-project workers. */
export async function listWorkerReferences(tx: TransactionDb, actor: BusinessSession): Promise<Array<{ id: string, name: string }>> {
  await authorize(tx, actor)
  const rows = await tx.select<{ id: string, record_json: string }>('SELECT id,record_json FROM workers ORDER BY id')
  return rows.flatMap((row) => {
    const item = reference(row)
    return item ? [{ id: item.id, name: item.name }] : []
  })
}
