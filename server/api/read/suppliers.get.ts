import { throwProjectReadError } from '../../utils/project-read-error'
import { supplierReadTestInstance } from '../../utils/supplier-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    return await supplierReadTestInstance.list(getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
