import type { ConstructionMainSelection, ConstructionScopeResult, ConstructionScopeSource } from '../../app/lib/construction-scope/contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { isDeepStrictEqual } from 'node:util'
import { decodeConstructionScopeSource } from '../../app/lib/construction-scope/contract'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { persistProductionConstructionScopeCommand as applyScopeCommand, assertProductionConstructionScope, decodeConstructionScopeCommand as command, constructionScopeDigest, constructionScopeLinkId, readProductionConstructionScopeLink as readLink, constructionScopeSourceCapability as sourceCapability, readProductionConstructionScopeSourceFact as sourceFact } from './production-construction-scope-record'

/** Called after its original owner's rows exist, before that same transaction commits its composite receipt. */
export async function appendProductionConstructionScopeBinding(tx: TransactionDb, actor: BusinessSession, input: { source: ConstructionScopeSource, main: ConstructionMainSelection, original: { family: 'material-contract' | 'finance-reimbursement' | 'subcontract-contract' | 'auxiliary-contract', commandId: string } }): Promise<ConstructionScopeResult> {
  await assertProductionConstructionScope(tx, actor)
  if (!['construction-scope:read', 'construction-scope:write', sourceCapability(input.source.domain)].every(capability => actor.capabilities.includes(capability)))
    return financeFailure('forbidden', '新建合同或原费用需要施工归属保存及所选来源的独立权限。')
  const source = decodeConstructionScopeSource(input.source)
  const commandId = `scope_${constructionScopeDigest([actor.workspaceId, actor.actorId, input.original, source])}`
  const old = (await tx.select<{ request_json: string, result_json: string | null }>('SELECT i.request_json,r.result_json FROM construction_scope_intents i LEFT JOIN construction_scope_receipts r ON r.command_id=i.command_id WHERE i.command_id=?', [commandId]))[0]
  if (old) {
    const previous = command(JSON.parse(old.request_json))
    if (previous.workspaceId !== actor.workspaceId || previous.actorId !== actor.actorId || previous.mainId !== input.main.id || previous.mainBasis !== input.main.basis || previous.projectId !== input.main.projectId || !isDeepStrictEqual(previous.originalSourceCommand, input.original) || !isDeepStrictEqual(previous.source, source))
      return financeFailure('conflict', '原来源命令已固定另一份施工归属，不能更换原内容。')
    if (old.result_json)
      return JSON.parse(old.result_json)
    return financeFailure('unavailable', '原组合命令缺可靠关联回执，请核对原来源编号。')
  }
  const fact = await sourceFact(tx, actor, source, true)
  if (!fact.basis || !fact.projectId)
    return financeFailure('validation-failed', '新建原来源必须已有真实工程项目，不能按名称或公司虚拟项目补关联。')
  const request = command({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'construction-scope:write', commandId, source, projectId: fact.projectId, action: 'bind', mainId: input.main.id, baseVersion: (await readLink(tx, source))?.version ?? null, sourceBasis: fact.basis, mainBasis: input.main.basis, originalSourceCommand: input.original })
  if (request.projectId !== input.main.projectId)
    return financeFailure('conflict', '所选施工主合同与原来源的真实工程项目不同。')
  await tx.execute('INSERT INTO construction_scope_intents VALUES(?,?,?,?,?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, constructionScopeLinkId(source), 'bind', constructionScopeDigest(request), JSON.stringify(request), new Date().toISOString()])
  return applyScopeCommand(tx, actor, request, true)
}
