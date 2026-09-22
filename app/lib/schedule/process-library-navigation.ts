import type { DataOriginDTO } from '../../types/read-model'
import { isDataOriginDTO } from '../../types/read-model'
import { isStableRouteIdentity } from '../util/stable-route-identity'

/** 只接受同来源的建组调用页；草稿仍由 KeepAlive 持有，URL 不携带业务正文。 */
export function processLibraryReturnTo(query: Record<string, unknown>): string | null {
  if (typeof query.returnTo !== 'string' || !isDataOriginDTO(query.origin))
    return null
  try {
    const url = new URL(query.returnTo, 'https://ruihang.invalid')
    if (!query.returnTo.startsWith('/schedule/new?') || url.origin !== 'https://ruihang.invalid' || url.pathname !== '/schedule/new' || url.hash
      || [...url.searchParams.keys()].some(key => !['project', 'origin'].includes(key))
      || url.searchParams.getAll('project').length !== 1 || url.searchParams.getAll('origin').length !== 1
      || !isStableRouteIdentity(url.searchParams.get('project')) || url.searchParams.get('origin') !== query.origin) {
      return null
    }
    return `/schedule/new?${new URLSearchParams({ project: url.searchParams.get('project')!, origin: query.origin })}`
  }
  catch { return null }
}

export function processLibraryNavigationQuery(origin: DataOriginDTO, returnTo: string | null, source?: string | null): Record<string, string> {
  const query: Record<string, string> = { origin }
  const target = processLibraryReturnTo({ origin, returnTo })
  if (target)
    query.returnTo = target
  if (source)
    query.source = source
  return query
}
