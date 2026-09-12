import { parseBoqBuildingQuery } from '../../../../app/lib/boq/central-building-request'
import { boqBuildingService } from '../../../utils/boq-building-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    return await boqBuildingService.read(parseBoqBuildingQuery(getQuery(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
