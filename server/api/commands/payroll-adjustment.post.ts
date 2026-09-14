import { parsePayrollAdjustmentCommand } from '../../../app/lib/payroll/central-adjustment-wire'
import { payrollService } from '../../utils/payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    return await payrollService.executeAdjustment(parsePayrollAdjustmentCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
