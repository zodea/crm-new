import { decodeConstructionScopeSource } from '../../../app/lib/construction-scope/contract'
import { productionConstructionScopeRuntime } from '../../utils/production-construction-scope-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    return await productionConstructionScopeRuntime(event).read(decodeConstructionScopeSource(query))
  }
  catch (cause) { throwQuantityError(cause) }
})
