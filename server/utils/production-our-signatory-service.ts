import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { OurSignatoryCommandResult, OurSignatoryResolution } from '../../app/lib/our-signatory/contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { isDeepStrictEqual } from 'node:util'
import { OurSignatoryRepositoryProblem, signatoryProblem } from '../../app/lib/our-signatory/contract'
import { commandFingerprint } from './command-journal'
import { ourSignatoryCommandKey, parseOurSignatoryCommand, readOurSignatories, validateOurSignatoryJournal, writeOurSignatory } from './our-signatory-owner'
import { createReadMeta, withReadMeta } from './read-meta'

export function createProductionOurSignatoryService(storage: Pick<ProductionStorage, 'identity' | 'assertBusinessWrite' | 'withTransaction'>) {
  type Session = () => BusinessSession
  const authorize = (session: Session, write: boolean) => {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('our-signatory:read') || (write && !actor.capabilities.includes('our-signatory:write')))
      return signatoryProblem('forbidden', '当前会话无我方主体目录权限')
    return actor
  }
  async function run<T>(session: Session, write: boolean, operation: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      if (!isDeepStrictEqual(authorize(session, write), actor))
        return signatoryProblem('forbidden', '会话已变化，请重新读取')
      await validateOurSignatoryJournal(tx, actor)
      const result = await operation(tx, actor)
      if (!isDeepStrictEqual(authorize(session, write), actor))
        return signatoryProblem('forbidden', '读取或提交期间会话变化，事务已撤回')
      return result
    })
  }
  return {
    list(session: Session) {
      return run(session, false, async (tx, actor) => {
        const { records, sourceVersion } = await readOurSignatories(tx)
        const asOf = new Date().toISOString()
        const meta = createReadMeta({ session: actor, schemaVersion: 'our-signatory-read-v2', operation: 'our-signatory:list', dataOrigin: 'real', asOf, coverage: 'complete', scope: {}, sources: [{ key: 'our-signatories', state: 'readable', sourceVersion, asOf }] })
        return withReadMeta({ records }, meta)
      })
    },
    async execute(body: unknown, session: Session) {
      const request = parseOurSignatoryCommand(body)
      const completed = await run<{ result?: OurSignatoryCommandResult, rejected?: OurSignatoryRepositoryProblem }>(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          return signatoryProblem('forbidden', '命令身份与当前会话不一致')
        const key = ourSignatoryCommandKey(request.commandId, actor)
        const sealed = await tx.select('SELECT scoped_id FROM our_signatory_resolutions WHERE scoped_id=?', [key])
        if (sealed.length)
          return signatoryProblem('conflict', '原命令已封存，请保留输入并使用新命令编号')
        const existing = await tx.select<{ fingerprint: string, result_json: string | null }>('SELECT fingerprint,result_json FROM our_signatory_commands WHERE scoped_id=?', [key])
        const fingerprint = commandFingerprint(request)
        if (existing.length && existing[0]!.fingerprint !== fingerprint)
          return signatoryProblem('validation-failed', '同一命令编号不能用于不同的完整请求')
        if (existing[0]?.result_json)
          return { result: JSON.parse(existing[0].result_json) as OurSignatoryCommandResult }
        if (!existing.length)
          await tx.execute('INSERT INTO our_signatory_commands VALUES(?,?,?,?,?,?,NULL,NULL)', [key, request.commandId, actor.workspaceId, actor.actorId, fingerprint, JSON.stringify(request)])
        try {
          const result = await writeOurSignatory(tx, request, actor)
          await tx.execute('UPDATE our_signatory_commands SET result_json=?,signatory_id=? WHERE scoped_id=?', [JSON.stringify(result), result.id, key])
          return { result }
        }
        catch (cause) {
          if (cause instanceof OurSignatoryRepositoryProblem && ['conflict', 'validation-failed', 'not-found'].includes(cause.problem.code))
            return { rejected: cause }
          throw cause
        }
      })
      if (completed.rejected)
        throw completed.rejected
      return completed.result!
    },
    resolve(commandId: string, session: Session): Promise<OurSignatoryResolution> {
      if (!/^[A-Z0-9][\w-]{2,79}$/i.test(commandId))
        return signatoryProblem('validation-failed', '原命令编号无效')
      return run(session, true, async (tx, actor) => {
        const key = ourSignatoryCommandKey(commandId, actor)
        const rows = await tx.select<{ result_json: string | null }>('SELECT result_json FROM our_signatory_commands WHERE scoped_id=?', [key])
        if (rows[0]?.result_json)
          return { outcome: 'applied', result: JSON.parse(rows[0].result_json) }
        await tx.execute('INSERT OR IGNORE INTO our_signatory_resolutions VALUES(?,?,?,?,?)', [key, commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied', commandId }
      })
    },
  }
}
