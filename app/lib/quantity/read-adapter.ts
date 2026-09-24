import type { SoftDb } from '../db/soft-delete'
import type { QuantityBatchReadQuery, QuantityContext, QuantityReadQuery, QuantityReadResult, QuantityUnitReadQuery } from './central-contract'
import type { QuantityPhotoIdentity } from './central-photo'
import type { QuantityRepository } from './central-repository'
import { loadQuantityAssignmentWorkspace } from './assignment'
import { loadQuantityBatchCompletionPlan } from './batch-completion'
import { quantityProblem } from './central-contract'
import { readQuantityCentralPhoto } from './central-photo'
import { loadQuantityStageWorkspace } from './central-stages'
import { loadQuantityCentralWorkspace } from './central-workspace'
import { loadQuantityCompletionWorkspace } from './completion'
import { loadQuantityRegionWorkspace } from './region'
import { loadQuantityTemplateWorkspace } from './template'
import { loadQuantityVarianceFacts } from './variance'

/** 正式来源始终走中央服务；演示只消费启动时获准的只读本地快照。 */
export function createQuantityReadAdapter(repository: QuantityRepository, local: {
  db: SoftDb
  includeDemo: () => boolean
  context: () => Promise<QuantityContext>
}) {
  async function read<T>(query: QuantityReadQuery, formal: () => Promise<QuantityReadResult<T>>, demo: () => Promise<T>): Promise<QuantityReadResult<T>> {
    if (query.origin === 'real')
      return formal()
    if (!query.includeDemo || !local.includeDemo())
      throw quantityProblem('forbidden', '请先开启有权限的演示数据')
    const context = await local.context()
    if (!context.capabilities.includes('demo:read') || !context.capabilities.includes('quantity:read') || !local.includeDemo())
      throw quantityProblem('forbidden', '当前没有演示工程量的读取权限')
    const data = await demo()
    return { data, dataOrigin: 'demo', sourceVersion: 'demo-local-readonly', asOf: new Date().toISOString(), capabilities: ['quantity:read'] }
  }
  return {
    boq: repository.boq,
    variance: (query: QuantityReadQuery) => read(query, () => repository.variance(query), async () => ({ projectId: query.projectId, facts: await loadQuantityVarianceFacts(local.db, query.projectId), boqSourceVersion: 'demo-local-readonly' })),
    workspace: (query: QuantityReadQuery) => read(query, () => repository.workspace(query), () => loadQuantityCentralWorkspace(local.db, query.projectId)),
    templates: (query: QuantityReadQuery) => read(query, () => repository.templates(query), () => loadQuantityTemplateWorkspace(local.db, query.projectId)),
    region: (query: QuantityReadQuery) => read(query, () => repository.region(query), () => loadQuantityRegionWorkspace(local.db, query.projectId)),
    stages: (query: QuantityReadQuery) => read(query, () => repository.stages(query), () => loadQuantityStageWorkspace(local.db, query.projectId)),
    assignments: (query: QuantityReadQuery) => read(query, () => repository.assignments(query), () => loadQuantityAssignmentWorkspace(local.db, query.projectId)),
    completion: (query: QuantityUnitReadQuery) => read(query, () => repository.completion(query), () => loadQuantityCompletionWorkspace(local.db, query.projectId, query.unitId)),
    batchPlan: (query: QuantityBatchReadQuery) => read(query, () => repository.batchPlan(query), () => loadQuantityBatchCompletionPlan(local.db, query.projectId, query)),
    photo: (query: QuantityReadQuery & QuantityPhotoIdentity, options: { signal?: AbortSignal } = {}) => read(query, () => repository.photo(query, options), async () => {
      options.signal?.throwIfAborted()
      const photo = await readQuantityCentralPhoto(local.db, query)
      options.signal?.throwIfAborted()
      return photo
    }),
  }
}

export type QuantityReadAdapter = ReturnType<typeof createQuantityReadAdapter>
