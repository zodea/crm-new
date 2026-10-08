import { boqFail } from '../../../utils/production-boq-record'
import { productionBoqImportRuntime } from '../../../utils/production-boq-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const owner = productionBoqImportRuntime(event)
    if (!owner)
      return boqFail('unavailable', '正式完整清单迁入尚未接通')
    return await owner.adopt(await readBody(event))
  }
  catch (cause) { throwQuantityError(cause) }
})
