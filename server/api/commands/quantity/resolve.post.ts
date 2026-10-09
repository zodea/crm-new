import { commandRecoveryKey, createCommandRecoveryStorage } from '../../../../app/lib/forms/command-recovery'
import { quantityProblem } from '../../../../app/lib/quantity/central-contract'
import { productionQuantityRuntime } from '../../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const encoded = JSON.stringify(body)
    const descriptor = createCommandRecoveryStorage(() => ({ getItem: () => encoded, setItem() {}, removeItem() {} })).read(commandRecoveryKey(body))
    if (!descriptor || descriptor.family !== 'quantity' || !descriptor.scopeId)
      throw quantityProblem('validation-failed', '原工程量恢复描述缺少稳定身份或项目')
    const production = productionQuantityRuntime(event)
    if (!production)
      throw quantityProblem('unavailable', '此原编号恢复入口只接已有正式工程量持久 owner')
    return await production.resolve(descriptor)
  }
  catch (cause) { throwQuantityError(cause) }
})
