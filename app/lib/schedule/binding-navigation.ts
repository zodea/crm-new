import type { DataOriginDTO } from '~/types/read-model'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { scheduleReturnContextQuery } from './navigation'

export function buildScheduleBindingLocation(projectId: string, groupId: string, origin: DataOriginDTO, query: Record<string, unknown> = {}, contractId = '') {
  return {
    path: `/schedule/${encodeURIComponent(projectId)}/bind/${encodeURIComponent(groupId)}`,
    query: { origin, ...(contractId ? { contract: contractId } : {}), ...scheduleReturnContextQuery(query), group: groupId },
  }
}

export function buildScheduleBindingFloorLocation(projectId: string, groupId: string, contractId: string, floorPlanId: string, query: Record<string, unknown>, lineId = '') {
  return { path: '/schedule', query: { ...scheduleReturnContextQuery(query), project: projectId, group: groupId, origin: 'real', floorPlan: floorPlanId, bindingContract: contractId, ...(lineId ? { bindingLine: lineId } : {}) } }
}

export function buildBoqBuildingEvidenceLocation(projectId: string, groupId: string, contractId: string, query: Record<string, unknown>, lineId = '', readonly = false) {
  const binding = buildScheduleBindingLocation(projectId, groupId, 'real', query, contractId)
  return { path: '/contract/boq/building-evidence', query: { project: projectId, contract: contractId, origin: 'real', ...(lineId ? { line: lineId } : {}), ...(readonly ? { mode: 'read' } : {}), returnTo: `${binding.path}?${new URLSearchParams(binding.query)}` } }
}

/** 写态往返单独验证，不能将完整绑定表单登记为可恢复的阅读页签。 */
export function parseScheduleBindingReturnTo(value: unknown, projectId: string, contractId: string, origin: DataOriginDTO): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 8192)
    return null
  try {
    const url = new URL(value, 'https://ruihang.invalid')
    const match = /^\/schedule\/([^/]+)\/bind\/([^/]+)$/.exec(url.pathname)
    if (!match || decodeURIComponent(match[1]!) !== projectId || !isStableRouteIdentity(decodeURIComponent(match[2]!)))
      return null
    const groupId = decodeURIComponent(match[2]!)
    if (url.searchParams.get('origin') !== origin || url.searchParams.get('contract') !== contractId)
      return null
    if (url.searchParams.has('group') && url.searchParams.get('group') !== groupId)
      return null
    for (const key of url.searchParams.keys()) {
      if (url.searchParams.getAll(key).length !== 1 || [...url.searchParams.get(key)!].some(character => character.charCodeAt(0) < 32))
        return null
    }
    const location = buildScheduleBindingLocation(projectId, groupId, origin, Object.fromEntries(url.searchParams), contractId)
    return `${location.path}?${new URLSearchParams(location.query)}`
  }
  catch { return null }
}
