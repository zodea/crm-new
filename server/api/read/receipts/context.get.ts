import { throwProjectReadError } from '../../../utils/project-read-error'
import { receiptReadTestInstance } from '../../../utils/receipt-read-test-instance'

export default defineEventHandler((event) => {
  try {
    return receiptReadTestInstance.context(getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
