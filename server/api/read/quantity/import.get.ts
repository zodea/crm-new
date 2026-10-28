import { quantityProblem } from '../../../../app/lib/quantity/central-contract'
import { productionQuantityRuntime } from '../../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionQuantityRuntime(event)
    if (!runtime)
      throw quantityProblem('unavailable', '完整量域来源采用只接正式工作区')
    return await runtime.imports.catalog()
  }
  catch (cause) { throwQuantityError(cause) }
})
