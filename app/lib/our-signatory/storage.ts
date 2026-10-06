import type { TransactionDb } from '../db/coordinator'
import type { OurSignatoryRecord, OurSignatorySnapshot } from './contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { decodeOurSignatoryDraft, signatoryProblem, signatorySnapshot } from './contract'

const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)
const isDeepStrictEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
export async function readOurSignatories(tx: TransactionDb): Promise<{ records: OurSignatoryRecord[], sourceVersion: string }> {
  const rows = await tx.select<{ id: string, draft_json: string, version: number, created_at: string, updated_at: string }>('SELECT * FROM our_signatories ORDER BY created_at,id')
  const revision = await tx.select<{ revision: number }>('SELECT revision FROM our_signatory_revision WHERE singleton=1')
  if (revision.length !== 1 || !Number.isSafeInteger(revision[0]!.revision) || revision[0]!.revision < 0)
    return signatoryProblem('unavailable', '我方主体目录版本依据缺失')
  const records = rows.map((row) => {
    if (!validId(row.id) || !Number.isSafeInteger(row.version) || row.version < 1 || !isISODateTimeDTO(row.created_at) || !isISODateTimeDTO(row.updated_at))
      return signatoryProblem('unavailable', '我方主体目录身份或版本损坏')
    return { id: row.id, draft: decodeOurSignatoryDraft(JSON.parse(row.draft_json)), version: String(row.version), createdAt: row.created_at, updatedAt: row.updated_at, history: [] as OurSignatoryRecord['history'] }
  })
  const history = await tx.select<{ signatory_id: string, version: number, draft_json: string, occurred_at: string, id: string, actor_id: string | null, command_id: string | null }>('SELECT * FROM our_signatory_history')
  for (const record of records) {
    const versions = history.filter(row => row.signatory_id === record.id)
    if (versions.length !== Number(record.version) || new Set(versions.map(row => row.version)).size !== versions.length || versions.some(row => !Number.isSafeInteger(row.version) || row.version < 1 || row.version > Number(record.version) || row.id !== `${record.id}-v${row.version}` || !isISODateTimeDTO(row.occurred_at) || !(row.actor_id === null || (typeof row.actor_id === 'string' && validId(row.actor_id))) || !(row.command_id === null || validId(row.command_id)))
      || versions.find(row => row.version === 1)?.occurred_at !== record.createdAt || versions.find(row => row.version === Number(record.version))?.occurred_at !== record.updatedAt
      || !isDeepStrictEqual(JSON.parse(versions.find(row => row.version === Number(record.version))?.draft_json ?? 'null'), record.draft)) {
      return signatoryProblem('unavailable', '我方主体不可变核实历史与当前资料不一致')
    }
    record.history = versions.sort((a, b) => b.version - a.version).map(row => ({ id: row.id, version: String(row.version), draft: decodeOurSignatoryDraft(JSON.parse(row.draft_json)), actorId: row.actor_id, commandId: row.command_id, occurredAt: row.occurred_at }))
  }
  if (history.some(row => !records.some(record => record.id === row.signatory_id)))
    return signatoryProblem('unavailable', '我方主体核实历史存在孤立身份')
  return { records, sourceVersion: `our-signatories-${revision[0]!.revision}` }
}

export async function resolveContractSignatory(tx: TransactionDb, input: { id?: string | null, version?: string | null, prior?: OurSignatorySnapshot | null, required: boolean }): Promise<OurSignatorySnapshot | null> {
  if (!input.id) {
    if (input.required)
      return signatoryProblem('validation-failed', '请选择实际我方签约主体', 'ourSignatoryId')
    return null
  }
  // Keep the exact contract's adopted facts; a directory rename is never a contract amendment.
  if (input.prior?.id === input.id)
    return structuredClone(input.prior)
  const { records } = await readOurSignatories(tx)
  const selected = records.find(row => row.id === input.id)
  if (!selected || selected.draft.status !== 'active')
    return signatoryProblem('validation-failed', '所选我方主体不存在或已停用', 'ourSignatoryId')
  if (input.version !== selected.version)
    return signatoryProblem('conflict', '我方主体资料已变化，请重新核对选择', 'ourSignatoryId')
  return signatorySnapshot(selected)
}
