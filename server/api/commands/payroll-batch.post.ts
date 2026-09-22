import { parsePayrollBatchCommand } from '../../../app/lib/payroll/central-batch-codec'
import { payrollService } from '../../utils/payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    return await payrollService.executeBatch(parsePayrollBatchCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
