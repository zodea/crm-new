import { isQuantityHollowActionKind, parseQuantityHollowCommand } from '../../../app/lib/quantity/central-hollow-validation'
import { productionQuantityRuntime } from '../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../utils/quantity-error'
import { parseQuantityCommand } from '../../utils/quantity-request'
import { quantityHollowTestInstance, quantityTestInstance } from '../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    const command = parseQuantityCommand(await readBody(event))
    const production = productionQuantityRuntime(event)
    if (production)
      return await production.quantity.execute(command)
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return isQuantityHollowActionKind(command.action.kind)
      ? await quantityHollowTestInstance.executeHollow(parseQuantityHollowCommand(command), sessionId)
      : await quantityTestInstance.execute(command, sessionId)
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
