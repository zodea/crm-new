import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { OurSignatoryCommandRequest, OurSignatoryCommandResult } from '../../app/lib/our-signatory/contract'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { decodeOurSignatoryDraft, signatoryProblem } from '../../app/lib/our-signatory/contract'
import { readOurSignatories } from '../../app/lib/our-signatory/storage'
import { isISODateTimeDTO } from '../../app/types/read-model'
import { commandFingerprint, commandJournalKey } from './command-journal'

export { readOurSignatories, resolveContractSignatory } from '../../app/lib/our-signatory/storage'
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)
}
export function parseOurSignatoryCommand(value: unknown): OurSignatoryCommandRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return signatoryProblem('validation-failed', '我方主体命令无效')
  const request = value as Record<string, unknown>
  if (Object.keys(request).some(key => !['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'id', 'baseVersion', 'draft'].includes(key))
    || !['workspaceId', 'actorId', 'commandId'].every(key => validId(request[key])) || (request.id !== undefined && !validId(request.id))
    || request.requiredCapability !== 'our-signatory:write' || !(request.baseVersion === null || (typeof request.baseVersion === 'string' && /^[1-9]\d*$/.test(request.baseVersion)))) {
    return signatoryProblem('validation-failed', '我方主体命令身份或版本无效')
  }
  const draft = decodeOurSignatoryDraft(request.draft, { allowBlankName: true })
  // The request retained for replay includes the full exact body; do not replace it with normalized facts.
  return { ...request, draft: { ...draft, name: (request.draft as Record<string, unknown>).name as string } } as unknown as OurSignatoryCommandRequest
}
export async function writeOurSignatory(tx: TransactionDb, request: OurSignatoryCommandRequest, actor: BusinessSession): Promise<OurSignatoryCommandResult> {
  const current = await readOurSignatories(tx)
  const existing = request.id ? current.records.find(row => row.id === request.id) : null
  if (request.id && !existing)
    return signatoryProblem('not-found', '我方主体不存在')
  if (existing ? existing.version !== request.baseVersion : request.baseVersion !== null)
    return signatoryProblem('conflict', '我方主体版本已变化，请先读取最新资料')
  const draft = decodeOurSignatoryDraft(request.draft)
  const id = existing?.id ?? `our-signatory-${randomUUID()}`
  const version = Number(existing?.version ?? 0) + 1
  const now = new Date().toISOString()
  const body = JSON.stringify(draft)
  await tx.execute('INSERT INTO our_signatories(id,draft_json,version,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET draft_json=excluded.draft_json,version=excluded.version,updated_at=excluded.updated_at', [id, body, version, existing?.createdAt ?? now, now])
  await tx.execute('INSERT INTO our_signatory_history VALUES(?,?,?,?,?,?,?)', [`${id}-v${version}`, id, version, body, actor.actorId, request.commandId, now])
  await tx.execute('UPDATE our_signatory_revision SET revision=revision+1 WHERE singleton=1')
  return { id, commandId: request.commandId, version: String(version), updatedAt: now }
}
export function ourSignatoryCommandKey(commandId: string, actor: BusinessSession) {
  return commandJournalKey(commandId, actor, 'our-signatory')
}
export async function validateOurSignatoryJournal(tx: TransactionDb, actor?: BusinessSession) {
  await readOurSignatories(tx)
  const rows = await tx.select<{
    scoped_id: string
    fingerprint: string
    request_json: string
    command_id: string
    workspace_id: string
    actor_id: string
    result_json: string | null
    signatory_id: string | null
  }>('SELECT * FROM our_signatory_commands')
  for (const row of rows) {
    const request = parseOurSignatoryCommand(JSON.parse(row.request_json))
    const owner = { workspaceId: row.workspace_id, actorId: row.actor_id, capabilities: ['our-signatory:write'] }
    if ((actor && (actor.workspaceId !== owner.workspaceId || actor.actorId !== owner.actorId))
      || row.scoped_id !== ourSignatoryCommandKey(row.command_id, owner) || row.command_id !== request.commandId || request.workspaceId !== row.workspace_id || request.actorId !== row.actor_id || commandFingerprint(request) !== row.fingerprint) {
      return signatoryProblem('unavailable', '我方主体原命令身份或请求证据损坏')
    }
    if (row.result_json !== null) {
      const result = JSON.parse(row.result_json) as OurSignatoryCommandResult
      if (Object.keys(result).sort().join(',') !== 'commandId,id,updatedAt,version' || result.commandId !== row.command_id || result.id !== row.signatory_id || !/^[1-9]\d*$/.test(result.version) || !isISODateTimeDTO(result.updatedAt)
        || (request.id !== undefined && request.id !== result.id) || request.baseVersion !== (Number(result.version) > 1 ? String(Number(result.version) - 1) : null)) {
        return signatoryProblem('unavailable', '我方主体原回执损坏')
      }
      const history = await tx.select<{
        draft_json: string
        actor_id: string | null
        command_id: string | null
        occurred_at: string
      }>('SELECT * FROM our_signatory_history WHERE signatory_id=? AND version=?', [result.id, Number(result.version)])
      if (history.length !== 1 || history[0]!.actor_id !== row.actor_id || history[0]!.command_id !== row.command_id || history[0]!.occurred_at !== result.updatedAt || !isDeepStrictEqual(JSON.parse(history[0]!.draft_json), decodeOurSignatoryDraft(request.draft)))
        return signatoryProblem('unavailable', '我方主体原回执缺实际核实版本')
    }
    else if (row.signatory_id !== null) {
      return signatoryProblem('unavailable', '未应用主体命令不能带回执归属')
    }
  }
  const resolutions = await tx.select<{
    scoped_id: string
    command_id: string
    workspace_id: string
    actor_id: string
    resolved_at: string
  }>('SELECT * FROM our_signatory_resolutions')
  for (const row of resolutions) {
    const owner = { workspaceId: row.workspace_id, actorId: row.actor_id, capabilities: [] }
    if (!validId(row.command_id) || !validId(row.workspace_id) || !validId(row.actor_id) || !isISODateTimeDTO(row.resolved_at)
      || row.scoped_id !== ourSignatoryCommandKey(row.command_id, owner) || (actor && (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId))
      || rows.some(command => command.scoped_id === row.scoped_id && command.result_json !== null)) {
      return signatoryProblem('unavailable', '我方主体原编号封存证据损坏')
    }
  }
}
