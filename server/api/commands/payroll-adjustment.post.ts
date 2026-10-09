import { parsePayrollAdjustmentCommand } from '../../../app/lib/payroll/central-adjustment-wire'
import { payrollServiceForEvent } from '../../utils/payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    return await payrollService.executeAdjustment(parsePayrollAdjustmentCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
