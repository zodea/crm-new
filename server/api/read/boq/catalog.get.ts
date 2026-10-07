import { boqFail } from '../../../utils/production-boq-record'
import { productionBoqRuntime } from '../../../utils/production-boq-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionBoqRuntime(event)
    if (!runtime)
      return boqFail('unavailable', '此入口只读取已接管的正式施工清单')
    return await runtime.catalog()
  }
  catch (cause) { throwQuantityError(cause) }
})
