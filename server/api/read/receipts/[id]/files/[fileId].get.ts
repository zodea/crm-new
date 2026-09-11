import { receiptProblem } from '../../../../../../app/lib/receipt/contract'
import { throwProjectReadError } from '../../../../../utils/project-read-error'
import { receiptReadTestInstance } from '../../../../../utils/receipt-read-test-instance'

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    if (getQuery(event).origin !== 'real')
      throw receiptProblem('forbidden', '当前来源的收款附件不可读')
    return receiptReadTestInstance.fileContent(getRouterParam(event, 'id') ?? '', getRouterParam(event, 'fileId') ?? '', getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
