import { payrollProblem } from '../../../app/lib/payroll/central-contract'
import { productionPayrollRuntime } from '../../utils/production-payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'commandId' || typeof (body as { commandId: unknown }).commandId !== 'string')
      throw payrollProblem('validation-failed', '工资迁入原编号恢复结构无效')
    const runtime = productionPayrollRuntime(event)
    if (!runtime)
      throw payrollProblem('unavailable', '完整SQLite工资迁入恢复只接正式持久owner')
    return runtime.migration.resolve((body as { commandId: string }).commandId)
  }
  catch (cause) { throwQuantityError(cause) }
})
