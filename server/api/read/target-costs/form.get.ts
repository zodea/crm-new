import { encodeTargetCostWire, parseTargetCostQuery } from '../../../../app/lib/target-cost/central-codec'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'
import { targetCostApi } from '../../../utils/target-cost-runtime'

export default defineEventHandler(async (event) => {
  try {
    const input = getQuery(event)
    return encodeTargetCostWire(await targetCostApi(event).budget.form(parseTargetCostQuery(input), typeof input.id === 'string' && input.id ? input.id : null, typeof input.draftKey === 'string' ? input.draftKey : undefined))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwQuantityError(cause)
  }
})
