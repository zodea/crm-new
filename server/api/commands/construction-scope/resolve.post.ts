import { financeFailure } from '../../../../app/lib/finance/central-contract'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../../../../app/lib/forms/command-recovery'
import { productionConstructionScopeRuntime } from '../../../utils/production-construction-scope-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const descriptor = createCommandRecoveryStorage(() => ({ getItem: () => JSON.stringify(body), setItem() {}, removeItem() {} })).read(commandRecoveryKey(body))
    if (!descriptor)
      return financeFailure('validation-failed', '原施工合同关联恢复描述缺失。')
    return await productionConstructionScopeRuntime(event).resolve(descriptor)
  }
  catch (cause) { throwQuantityError(cause) }
})
