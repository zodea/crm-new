import { defineEventHandler, getHeader, readBody } from 'h3'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { receiptCommandTestInstance } from '../../../utils/receipt-command-service'
import { receiptReadTestInstance } from '../../../utils/receipt-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const commandId = parseResolveCommandBody(await readBody(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return receiptCommandTestInstance.resolve(commandId, receiptReadTestInstance.session(sessionId), sessionId)
  }
  catch (cause) { throwProjectReadError(cause) }
})
