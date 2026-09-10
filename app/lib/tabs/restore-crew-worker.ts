import type { TabRestoreResult } from './restoration-contract'
import type { LoadedTarget, RestoreDetailOptions } from './restore-detail'
import type { CrewWorkerRelationFactKindDTO } from '~/lib/crew-worker/repository'
import type { EntityRefDTO } from '~/types/read-model'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { checkRestoreAbort, restoreProblem } from './restore-problem'

/** 事实身份只能证明存在；还必须在当前归属对象的只读明细里找到同一事实。 */
export async function readRestoredCrewWorkerFact(options: RestoreDetailOptions): Promise<LoadedTarget | TabRestoreResult> {
  const { url, detail, repositories } = options
  const ownerKind = url.searchParams.get('ownerKind')
  const ownerId = url.searchParams.get('ownerId')
  if (ownerKind == null && ownerId == null)
    return restoreProblem('not-connected')
  if (!url.searchParams.has('origin') || (ownerKind !== 'crew' && ownerKind !== 'worker') || !isStableRouteIdentity(ownerId))
    return restoreProblem('mismatch')
  const kind = detail.kind as CrewWorkerRelationFactKindDTO
  const capability = `${ownerKind}:list:read`
  if (!options.capabilities().includes(capability))
    return restoreProblem('forbidden')
  if (ownerKind === 'crew' && kind !== 'penalty')
    return restoreProblem('not-connected')
  const origin = options.path.origin!
  const query = { origin, includeDemo: options.includeDemo() }
  const repository = repositories.crewWorkerRead
  const identity = await repository.getRelationFactIdentity({ ...query, id: detail.id, kind })
  checkRestoreAbort(options.signal)
  if (identity.id !== detail.id || identity.kind !== kind || identity.dataOrigin !== origin
    || !identity.owners.some(owner => owner.kind === ownerKind && owner.id === ownerId)
    || (kind === 'assignment' && identity.projectId !== detail.secondId)) {
    return restoreProblem('mismatch')
  }
  if (!options.capabilities().includes(capability) || (origin === 'demo' && (!options.includeDemo() || !options.capabilities().includes('demo:read'))))
    return restoreProblem('forbidden')
  let subject: EntityRefDTO | undefined
  let sourceVersion: string | null
  let capabilities: readonly string[]
  if (ownerKind === 'crew') {
    const dto = await repository.getCrew({ ...query, id: ownerId })
    checkRestoreAbort(options.signal)
    if (dto.crew.id !== ownerId || dto.dataOrigin !== origin)
      return restoreProblem('mismatch')
    subject = dto.penalties.find(row => row.penalty.id === detail.id)?.penalty
    sourceVersion = dto.sourceVersion
    capabilities = dto.capabilities
  }
  else {
    const dto = await repository.getWorker({ ...query, id: ownerId })
    checkRestoreAbort(options.signal)
    if (dto.worker.id !== ownerId || dto.dataOrigin !== origin)
      return restoreProblem('mismatch')
    subject = kind === 'assignment'
      ? dto.assignments.find(row => row.unit.id === detail.id && row.project.state === 'resolved' && row.project.id === detail.secondId)?.unit
      : kind === 'wage'
        ? dto.wageStatements.find(row => row.statement.id === detail.id)?.statement
        : dto.penalties.find(row => row.penalty.id === detail.id)?.penalty
    sourceVersion = dto.sourceVersion
    capabilities = dto.capabilities
  }
  if (!capabilities.includes(capability))
    return restoreProblem('forbidden')
  if (!subject)
    return restoreProblem('not-found')
  return {
    subject,
    origin,
    capability,
    capabilities,
    sourceVersion,
    variant: kind === 'penalty' ? 'penalty-detail' : 'detail',
    filters: { ownerKind, ownerId, ...(kind === 'assignment' ? { projectId: detail.secondId! } : {}) },
  }
}
