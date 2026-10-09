import { boqFail } from '../../../utils/production-boq-record'
import { boqClosed } from '../../../utils/production-boq-request'
import { productionBoqRuntime } from '../../../utils/production-boq-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const scope = boqClosed(getQuery(event), ['projectId', 'contractId', 'origin'])
    if (scope.origin !== 'real' || typeof scope.projectId !== 'string' || typeof scope.contractId !== 'string')
      return boqFail('validation-failed', '分项候选须属于实际施工主合同项目')
    const runtime = productionBoqRuntime(event)
    if (!runtime)
      return boqFail('unavailable', '正式清单 owner 尚未接通')
    return await runtime.items({ projectId: scope.projectId, contractId: scope.contractId, origin: 'real' })
  }
  catch (cause) { throwQuantityError(cause) }
})
