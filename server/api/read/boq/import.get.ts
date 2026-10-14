import { boqFail } from '../../../utils/production-boq-record'
import { boqClosed } from '../../../utils/production-boq-request'
import { productionBoqImportRuntime } from '../../../utils/production-boq-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    boqClosed(getQuery(event), [])
    const owner = productionBoqImportRuntime(event)
    if (!owner)
      return boqFail('unavailable', '正式完整清单迁入尚未接通，不读取开发主档')
    return await owner.state()
  }
  catch (cause) { throwQuantityError(cause) }
})
