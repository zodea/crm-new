import { commandRecoveryKey, createCommandRecoveryStorage } from '../../../../../app/lib/forms/command-recovery'
import { quantityProblem } from '../../../../../app/lib/quantity/central-contract'
import { productionQuantityRuntime } from '../../../../utils/production-quantity-runtime'
import { throwQuantityError } from '../../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const encoded = JSON.stringify(body)
    const descriptor = createCommandRecoveryStorage(() => ({ getItem: () => encoded, setItem() {}, removeItem() {} })).read(commandRecoveryKey(body))
    if (!descriptor || descriptor.family !== 'quantity-import' || !descriptor.scopeId)
      throw quantityProblem('validation-failed', '原完整量域采用定位无效')
    const runtime = productionQuantityRuntime(event)
    if (!runtime)
      throw quantityProblem('unavailable', '该原采用恢复只接正式工作区')
    return await runtime.imports.resolve({ ...descriptor, scopeId: descriptor.scopeId })
  }
  catch (cause) { throwQuantityError(cause) }
})
