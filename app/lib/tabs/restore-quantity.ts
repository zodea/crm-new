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
