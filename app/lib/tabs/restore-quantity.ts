import type { TabRestoreResult } from './restoration-contract'
import type { LoadedTarget, RestoreDetailOptions } from './restore-detail'
import { QUANTITY_READ_CAPABILITY } from '../quantity/central-contract'
import { checkRestoreAbort, restoreProblem } from './restore-problem'

/** 普通户详情由当前量域读取证明项目归属；工人关联入口仍走原归属校验。 */
export async function readRestoredQuantityUnit(options: RestoreDetailOptions): Promise<LoadedTarget | TabRestoreResult> {
  if (!options.capabilities().includes(QUANTITY_READ_CAPABILITY))
    return restoreProblem('forbidden')
  const { detail, path } = options
  const dto = await options.repositories.quantity.completion({ projectId: detail.secondId!, unitId: detail.id, origin: path.origin!, includeDemo: options.includeDemo() }, { signal: options.signal })
  checkRestoreAbort(options.signal)
  if (dto.data.projectId !== detail.secondId)
    return restoreProblem('mismatch')
  return {
    subject: { state: 'resolved', entity: 'quantity-unit', id: dto.data.unit.id, label: dto.data.unit.name, no: null },
    origin: dto.dataOrigin,
    sourceVersion: dto.sourceVersion,
    capabilities: dto.capabilities,
    capability: QUANTITY_READ_CAPABILITY,
    variant: 'detail',
    filters: { projectId: detail.secondId! },
  }
}

/** 空鼓详情恢复必须冷读原户和精确原修订；不能用普通完成详情证明另一记录。 */
export async function readRestoredQuantityHollow(options: RestoreDetailOptions): Promise<LoadedTarget | TabRestoreResult> {
  if (!options.capabilities().includes(QUANTITY_READ_CAPABILITY))
    return restoreProblem('forbidden')
  const { detail, path, url } = options
  const read = await options.repositories.quantity.hollow({ projectId: detail.secondId!, unitId: detail.unitId!, origin: path.origin!, includeDemo: options.includeDemo() }, { signal: options.signal })
  checkRestoreAbort(options.signal)
  const record = read.data.records.find(record => record.recordId === detail.id)
  const revisionId = url.searchParams.get('revisionId')
  if (read.data.projectId !== detail.secondId || read.data.unitId !== detail.unitId || read.dataOrigin !== path.origin || !record || (revisionId && !record.revisions.some(revision => revision.revisionId === revisionId)))
    return restoreProblem('mismatch')
  if (!record.source.navigation)
    return restoreProblem('forbidden')
  return { subject: { state: 'resolved', entity: 'quantity-unit', id: read.data.unitId, label: `${record.location.unitName} 空鼓检查`, no: null }, origin: read.dataOrigin, sourceVersion: read.sourceVersion, capabilities: read.capabilities, capability: QUANTITY_READ_CAPABILITY, variant: 'hollow-record', filters: { projectId: read.data.projectId, recordId: record.recordId, ...(revisionId ? { revisionId } : {}) } }
}
