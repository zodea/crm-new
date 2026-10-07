import { parseBoqBuildingQuery } from '../../../../app/lib/boq/central-building-request'
import { boqBuildingService } from '../../../utils/boq-building-runtime'
import { boqClosed } from '../../../utils/production-boq-request'
import { productionBoqRuntime } from '../../../utils/production-boq-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const owner = productionBoqRuntime(event)
    if (owner) {
      boqClosed(getQuery(event), ['projectId', 'contractId', 'origin'])
      return await owner.building(parseBoqBuildingQuery(getQuery(event)))
    }
    return await boqBuildingService.read(parseBoqBuildingQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
