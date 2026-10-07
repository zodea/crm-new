import { targetCostProblem } from '../../../../app/lib/target-cost/central-contract'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostApi } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    const owner = targetCostApi(event)
    if (!owner.migration)
      throw targetCostProblem('unavailable', '预算正式接管来源尚未配置')
    return await owner.migration.adopt(await readBody(event), owner.session)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwQuantityError(cause)
  }
})
