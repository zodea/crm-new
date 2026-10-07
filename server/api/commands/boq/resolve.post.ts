import { commandRecoveryKey, createCommandRecoveryStorage } from '../../../../app/lib/forms/command-recovery'
import { boqFail } from '../../../utils/production-boq-record'
import { productionBoqRuntime } from '../../../utils/production-boq-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const descriptor = createCommandRecoveryStorage(() => ({ getItem: () => JSON.stringify(body), setItem() {}, removeItem() {} })).read(commandRecoveryKey(body))
    if (!descriptor || descriptor.family !== 'boq' || !descriptor.scopeId)
      return boqFail('validation-failed', '清单恢复只接受可靠原编号与最小定位')
    const runtime = productionBoqRuntime(event)
    if (!runtime)
      return boqFail('unavailable', '正式清单 owner 尚未接通')
    return await runtime.resolve(descriptor)
  }
  catch (cause) { throwQuantityError(cause) }
})
