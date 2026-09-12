import type { DataOriginDTO } from '../../types/read-model'
import { resolveNavigationTarget } from '../nav/target-registry'
import { isStableRouteIdentity } from '../util/stable-route-identity'

export function targetCostProjectTarget(input: { projectId: string | null, projectName: string, origin: DataOriginDTO, allowed: boolean, returnTo?: string }): string | null {
  if (!input.allowed || !isStableRouteIdentity(input.projectId))
    return null
  const target = resolveNavigationTarget({ kind: 'entity-detail', subject: { state: 'resolved', entity: 'project', id: input.projectId, label: input.projectName || '关联项目', no: null }, variant: 'detail', view: null, filters: { dataOrigin: input.origin } }, { returnTo: input.returnTo })
  return target.state === 'resolved' ? target.to : null
}
