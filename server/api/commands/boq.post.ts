import { boqFail } from '../../utils/production-boq-record'
import { productionBoqRuntime } from '../../utils/production-boq-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionBoqRuntime(event)
    if (!runtime)
      return boqFail('unavailable', '此命令只写正式施工清单 owner')
    return await runtime.execute(await readBody(event))
  }
  catch (cause) { throwQuantityError(cause) }
})
