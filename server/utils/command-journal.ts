import type { CommandResolution } from '../../app/lib/forms/command-recovery'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { createError } from 'h3'

export interface CommandJournal<Result> {
  commands: Map<string, Result>
  commandFingerprints: Map<string, string>
  sealedCommands: Set<string>
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

/** 不添加默认值或重写数组顺序；旧 receipt 使用相同 SHA-256 规范化。 */
export function commandFingerprint(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex')
}

export function commandJournalKey(commandId: string, actor: BusinessSession, family: string): string {
  return JSON.stringify([actor.workspaceId, actor.actorId, family, commandId])
}

/** 领域 owner 持有并提交这些记录；此函数不另建事实源或事务。 */
export function commandReplay<Result, Request extends { commandId: string }>(
  journal: CommandJournal<Result>,
  request: Request,
  actor: BusinessSession,
  family: string,
  reject: (message: string) => Error,
): { key: string, fingerprint: string, previous: Result | null } {
  const key = commandJournalKey(request.commandId, actor, family)
  if (journal.sealedCommands.has(key))
    throw reject('原命令已核对并封存为未应用，请以新意图重新提交')
  const fingerprint = commandFingerprint(request)
  const priorFingerprint = journal.commandFingerprints.get(key)
  if (priorFingerprint !== undefined && priorFingerprint !== fingerprint)
    throw reject('同一命令编号不能提交不同动作、目标或内容')
  journal.commandFingerprints.set(key, fingerprint)
  const prior = journal.commands.get(key)
  return { key, fingerprint, previous: prior === undefined ? null : structuredClone(prior) }
}

/** 发布前重查封存记录，使尚在异步等待的原请求不能在核对后迟到写入。 */
export function assertCommandUnsealed<Result>(journal: CommandJournal<Result>, key: string, reject: (message: string) => Error): void {
  if (journal.sealedCommands.has(key))
    throw reject('原命令已封存为未应用，迟到请求不能继续保存')
}

export function resolveJournalCommand<Result>(journal: CommandJournal<Result>, commandId: string, actor: BusinessSession, family: string): CommandResolution<Result> {
  const key = commandJournalKey(commandId, actor, family)
  const prior = journal.commands.get(key)
  if (prior !== undefined)
    return { outcome: 'applied', result: structuredClone(prior) }
  journal.sealedCommands.add(key)
  return { outcome: 'not-applied', commandId }
}

export function parseResolveCommandBody(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !('commandId' in body)
    || typeof body.commandId !== 'string' || !/^[A-Z0-9][\w-]{2,79}$/i.test(body.commandId)) {
    throw createError({ statusCode: 422, message: '核对原提交仅接受有效的 commandId' })
  }
  return body.commandId
}
