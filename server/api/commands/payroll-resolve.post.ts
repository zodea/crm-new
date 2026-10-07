import { commandRecoveryKey, createCommandRecoveryStorage } from '../../../app/lib/forms/command-recovery'
import { payrollProblem } from '../../../app/lib/payroll/central-contract'
import { productionPayrollRuntime } from '../../utils/production-payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const encoded = JSON.stringify(body)
    const descriptor = createCommandRecoveryStorage(() => ({ getItem: () => encoded, setItem() {}, removeItem() {} })).read(commandRecoveryKey(body))
    if (!descriptor || descriptor.family !== 'payroll')
      throw payrollProblem('validation-failed', '原工资恢复描述无效')
    const runtime = productionPayrollRuntime(event)
    if (!runtime)
      throw payrollProblem('unavailable', '该原编号恢复入口只接已有正式工资持久owner')
    return runtime.resolve(descriptor)
  }
  catch (cause) { throwQuantityError(cause) }
})
