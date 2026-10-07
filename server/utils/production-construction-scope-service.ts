import type { ConstructionScopeCommand, ConstructionScopeResult, ConstructionScopeSource } from '../../app/lib/construction-scope/contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor, CommandResolution } from '../../app/lib/forms/command-recovery'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { isDeepStrictEqual } from 'node:util'
import { constructionScopeSourceKey, decodeConstructionScopeSource } from '../../app/lib/construction-scope/contract'
import { financeFailure, FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { persistProductionConstructionScopeCommand as applyScopeCommand, assertProductionConstructionScope, decodeConstructionScopeCommand as command, constructionScopeDigest, constructionScopeLinkId, readProductionConstructionScope, constructionScopeSourceCapability as sourceCapability, validateProductionConstructionScopeState } from './production-construction-scope-record'

type Session = () => BusinessSession
type Row = Record<string, unknown>

export function createProductionConstructionScopeService(storage: ProductionStorage) {
  function authorize(session: Session, write = false) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('construction-scope:read') || (write && !actor.capabilities.includes('construction-scope:write')))
      return financeFailure('forbidden', '无当前正式工作区的施工合同关联权限。')
    return actor
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await assertProductionConstructionScope(tx, actor)
      await validateProductionConstructionScopeState(tx)
      const result = await work(tx, actor)
      if (!isDeepStrictEqual(authorize(session, write), actor))
        return financeFailure('forbidden', '关联操作期间身份或权限变化，事务已撤回，请保留原编号。')
      return result
    })
  }
  async function original(tx: TransactionDb, actor: BusinessSession, id: string) {
    const receipt = (await tx.select<Row>('SELECT * FROM construction_scope_receipts WHERE command_id=?', [id]))[0]
    if (!receipt)
      return null
    if (receipt.workspace_id !== actor.workspaceId || receipt.actor_id !== actor.actorId)
      return financeFailure('forbidden', '原关联回执属于其他身份。')
    return JSON.parse(String(receipt.result_json)) as ConstructionScopeResult
  }
  const seal = (tx: TransactionDb, actor: BusinessSession, input: Pick<ConstructionScopeCommand, 'commandId' | 'source' | 'action'>) => tx.execute('INSERT OR IGNORE INTO construction_scope_resolutions VALUES(?,?,?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, constructionScopeLinkId(input.source), input.action, new Date().toISOString()])
  return {
    read: (source: ConstructionScopeSource, session: Session) => run(session, false, (tx, actor) => readProductionConstructionScope(tx, actor, decodeConstructionScopeSource(source))),
    execute: async (value: unknown, session: Session): Promise<ConstructionScopeResult> => {
      const input = command(value)
      if (input.originalSourceCommand)
        return financeFailure('validation-failed', '新建时的工程归属请随原合同或原费用命令一起保存。')
      const digest = constructionScopeDigest(input)
      await run(session, true, async (tx, actor) => {
        if (input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId || !actor.capabilities.includes(sourceCapability(input.source.domain)))
          return financeFailure('forbidden', '所选来源或命令身份与当前权限不一致。')
        const old = (await tx.select<Row>('SELECT * FROM construction_scope_intents WHERE command_id=?', [input.commandId]))[0]
        if (old && (old.workspace_id !== actor.workspaceId || old.actor_id !== actor.actorId || old.fingerprint !== digest))
          return financeFailure('conflict', '原关联编号已经绑定另一份内容，不能替换原请求。')
        if (!old)
          await tx.execute('INSERT INTO construction_scope_intents VALUES(?,?,?,?,?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, constructionScopeLinkId(input.source), input.action, digest, JSON.stringify(input), new Date().toISOString()])
      })
      try {
        return await run(session, true, (tx, actor) => applyScopeCommand(tx, actor, input))
      }
      catch (cause) {
        if (cause instanceof FinanceRepositoryProblem && ['conflict', 'not-found', 'validation-failed'].includes(cause.problem.code))
          await run(session, true, (tx, actor) => seal(tx, actor, input))
        throw cause
      }
    },
    resolve: (descriptor: CommandRecoveryDescriptor, session: Session): Promise<CommandResolution<ConstructionScopeResult>> => run(session, false, async (tx, actor) => {
      if (descriptor.family !== 'construction-scope' || descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || !descriptor.targetId || !descriptor.scopeId || !['bind', 'unbind'].includes(descriptor.action) || !/^[a-z0-9][\w-]{2,79}$/i.test(descriptor.commandId))
        return financeFailure('validation-failed', '原施工合同关联恢复范围无效。')
      const boundary = descriptor.targetId.indexOf(':')
      let source: ConstructionScopeSource
      try {
        source = decodeConstructionScopeSource({ domain: descriptor.targetId.slice(0, boundary), id: descriptor.targetId.slice(boundary + 1) })
      }
      catch {
        return financeFailure('validation-failed', '原施工合同关联稳定来源无效。')
      }
      if (!actor.capabilities.includes(sourceCapability(source.domain)))
        return financeFailure('forbidden', '当前身份无原合同或费用来源恢复权限。')
      const parentId = source.domain !== 'original-expense' ? source.id : (await tx.select<{ reimbursement_id: string }>('SELECT reimbursement_id FROM expense_reimbursement_lines WHERE id=?', [source.id]))[0]?.reimbursement_id
      if (descriptor.scopeId !== parentId)
        return financeFailure('conflict', '原关联编号不属于当前合同或费用表单。')
      const intent = (await tx.select<Row>('SELECT * FROM construction_scope_intents WHERE command_id=?', [descriptor.commandId]))[0]
      const input = intent ? command(JSON.parse(String(intent.request_json))) : null
      if (intent && (!input || intent.workspace_id !== actor.workspaceId || intent.actor_id !== actor.actorId || intent.link_id !== constructionScopeLinkId(source) || intent.action !== descriptor.action || constructionScopeSourceKey(input.source) !== descriptor.targetId || intent.fingerprint !== constructionScopeDigest(input)))
        return financeFailure('conflict', '原编号与所选关联或动作不一致。')
      if (input && !actor.capabilities.includes(sourceCapability(input.source.domain)))
        return financeFailure('forbidden', '当前身份无原合同或费用来源恢复权限。')
      const result = await original(tx, actor, descriptor.commandId)
      if (result)
        return { outcome: 'applied', result }
      storage.assertBusinessWrite()
      const old = (await tx.select<Row>('SELECT * FROM construction_scope_resolutions WHERE command_id=?', [descriptor.commandId]))[0]
      if (old && (old.workspace_id !== actor.workspaceId || old.actor_id !== actor.actorId || old.link_id !== constructionScopeLinkId(source) || old.action !== descriptor.action))
        return financeFailure('conflict', '封存的原编号属于其他恢复范围。')
      if (!old)
        await tx.execute('INSERT INTO construction_scope_resolutions VALUES(?,?,?,?,?,?)', [descriptor.commandId, actor.workspaceId, actor.actorId, constructionScopeLinkId(source), descriptor.action, new Date().toISOString()])
      return { outcome: 'not-applied', commandId: descriptor.commandId }
    }),
  }
}
