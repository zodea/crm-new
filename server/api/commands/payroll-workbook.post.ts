import { payrollWorkbookServiceForEvent } from '../../utils/payroll-workbook-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollWorkbookService = payrollWorkbookServiceForEvent(event)
    return await payrollWorkbookService.executeWorkbook(await readBody(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
