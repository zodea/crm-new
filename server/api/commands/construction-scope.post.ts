import { productionConstructionScopeRuntime } from '../../utils/production-construction-scope-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    return await productionConstructionScopeRuntime(event).execute(await readBody(event))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
