import { parseDeliveryCommand } from '../../utils/delivery-command-request'
import { deliveryCommandTestInstance, deliveryReadTestInstance } from '../../utils/delivery-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return deliveryCommandTestInstance.execute(parseDeliveryCommand(await readBody(event)), deliveryReadTestInstance.session(sessionId), sessionId)
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
