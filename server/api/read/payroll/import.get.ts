import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { productionPayrollRuntime } from '../../../utils/production-payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionPayrollRuntime(event)
    if (!runtime)
      throw payrollProblem('unavailable', '完整SQLite工资迁入只接正式持久owner')
    return runtime.migration.state()
  }
  catch (cause) { throwQuantityError(cause) }
})
