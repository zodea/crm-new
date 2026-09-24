import { deliveryReadTestInstance } from '../../../../../utils/delivery-runtime'
import { throwProjectReadError } from '../../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return deliveryReadTestInstance.fileContent(getRouterParam(event, 'id') ?? '', getRouterParam(event, 'assetId') ?? '', getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
