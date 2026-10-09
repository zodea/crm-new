import { parsePayrollC2Command } from '../../../app/lib/payroll/central-c2-codec'
import { payrollServiceForEvent } from '../../utils/payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    return await payrollService.executeC2(parsePayrollC2Command(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
