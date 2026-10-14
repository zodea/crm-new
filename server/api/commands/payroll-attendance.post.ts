import { parsePayrollAttendanceCommand } from '../../../app/lib/payroll/central-attendance-codec'
import { payrollServiceForEvent } from '../../utils/payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    return await payrollService.executeAttendance(parsePayrollAttendanceCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
