import { quantityProblem } from '../../../../app/lib/quantity/central-contract'
import { productionQuantityRuntime } from '../../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionQuantityRuntime(event)
    if (!runtime)
      throw quantityProblem('unavailable', '该完整量域采用入口只接正式工作区')
    return await runtime.imports.execute(await readBody(event))
  }
  catch (cause) { throwQuantityError(cause) }
})
