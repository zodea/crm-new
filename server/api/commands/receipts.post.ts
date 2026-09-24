import { throwProjectReadError } from '../../utils/project-read-error'
import { parseReceiptCommand } from '../../utils/receipt-command-request'
import { receiptCommandTestInstance } from '../../utils/receipt-command-service'
import { receiptReadTestInstance } from '../../utils/receipt-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return receiptCommandTestInstance.execute(parseReceiptCommand(await readBody(event)), receiptReadTestInstance.session(sessionId), sessionId)
  }
  catch (cause) { throwProjectReadError(cause) }
})
