import { parsePayrollAFeesCommand } from '../../../app/lib/payroll/central-a-fees-codec'
import { payrollServiceForEvent } from '../../utils/payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    return await payrollService.executeFees(parsePayrollAFeesCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
