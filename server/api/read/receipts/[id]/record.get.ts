import { throwProjectReadError } from '../../../../utils/project-read-error'
import { receiptReadTestInstance } from '../../../../utils/receipt-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    return await receiptReadTestInstance.detail(getRouterParam(event, 'id') ?? '', getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
