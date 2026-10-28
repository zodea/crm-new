import { boqBuildingService } from '../../utils/boq-building-runtime'
import { productionBoqRuntime } from '../../utils/production-boq-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const owner = productionBoqRuntime(event)
    if (owner)
      return await owner.correctBuilding(await readBody(event))
    return await boqBuildingService.execute(await readBody(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
