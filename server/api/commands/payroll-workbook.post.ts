import { payrollWorkbookService } from '../../utils/payroll-workbook-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    return await payrollWorkbookService.executeWorkbook(await readBody(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
