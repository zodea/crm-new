import type { PaginationDTO, ReadMetaDTO } from '../../types/read-model'
import { isReadMetaDTO } from './meta'
import { isPaginationDTO } from './pagination'

interface ProvenPage<T> {
  items: T[]
  pagination: PaginationDTO
  meta: ReadMetaDTO
  originMeta?: Record<string, ReadMetaDTO>
}

function proof(page: ProvenPage<unknown>): string {
  const metas = page.originMeta ? Object.values(page.originMeta) : [page.meta]
  if (!isReadMetaDTO(page.meta) || page.meta.sourceVersion === null || page.meta.authorizedScope.coverage === 'unknown'
    || metas.some(meta => !isReadMetaDTO(meta)
      || (meta.sources.some(source => source.state === 'readable') && (meta.sourceVersion === null || meta.authorizedScope.coverage === 'unknown')))) {
    throw new Error('无法证明候选或导出来源完整，请重新读取')
  }
  return JSON.stringify(metas.map(({ schemaVersion, workspaceId, actorId, dataOrigin, sourceVersion, authorizedScope, capabilities, sources }) => ({
    schemaVersion,
    workspaceId,
    actorId,
    dataOrigin,
    sourceVersion,
    authorizedScope,
    capabilities,
    sources: sources.map(({ key, state, sourceVersion }) => ({ key, state, sourceVersion })),
  })))
}

/** A completed authorized collection never combines pages from different owner versions or scopes. */
export async function collectReadPages<P extends ProvenPage<unknown>>(input: {
  load: (page: number) => Promise<P>
  identity: (item: P['items'][number]) => string
  isCurrent?: () => boolean
}): Promise<{ items: Array<P['items'][number]>, first: P }> {
  const items: Array<P['items'][number]> = []
  const identities = new Set<string>()
  let first: P | undefined
  let expectedProof = ''
  for (let page = 1; ; page++) {
    const current = await input.load(page)
    if (input.isCurrent?.() === false)
      throw new Error('读取期间权限、来源或查询已变化，请重新读取')
    if (!isPaginationDTO(current.pagination, current.items.length) || current.pagination.requestedPage !== page || current.pagination.page !== page)
      throw new Error('候选或导出分页缺失，请重新读取')
    const currentProof = proof(current)
    if (!first) {
      first = current
      expectedProof = currentProof
    }
    else if (currentProof !== expectedProof || current.pagination.total !== first.pagination.total || current.pagination.pageSize !== first.pagination.pageSize) {
      throw new Error('读取期间版本或授权范围已变化，请重新读取')
    }
    for (const item of current.items) {
      if (typeof item === 'object' && item !== null && 'dataOrigin' in item) {
        const origin = String(item.dataOrigin)
        const itemMeta = current.originMeta?.[origin] ?? (current.meta.dataOrigin === origin ? current.meta : null)
        if (!itemMeta || itemMeta.sourceVersion === null || itemMeta.authorizedScope.coverage === 'unknown')
          throw new Error('候选或导出记录来源未取得完整证明，请重新读取')
      }
      const identity = input.identity(item)
      if (!identity || identities.has(identity))
        throw new Error('候选或导出包含重复身份，请重新读取')
      identities.add(identity)
      items.push(item)
    }
    if (items.length === current.pagination.total)
      return { items, first }
    if (items.length > current.pagination.total || current.items.length === 0)
      throw new Error('候选或导出数量不完整，请重新读取')
  }
}
