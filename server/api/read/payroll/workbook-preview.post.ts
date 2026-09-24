import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { numberingExact, numberingObject } from '../../../../app/lib/payroll/central-numbering-codec'
import { encodePayrollWorkbookRead } from '../../../../app/lib/payroll/workbook-codec'
import { parsePayrollWorkbookInput } from '../../../../app/lib/payroll/workbook-validation'
import { payrollWorkbookService } from '../../../utils/payroll-workbook-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!numberingObject(body) || !numberingExact(body, ['query', 'input']) || !numberingObject(body.query))
      throw payrollProblem('invalid-query', '工资输出目录读取格式无效')
    const result = await payrollWorkbookService.workbookPreview(parsePayrollQuery(body.query), parsePayrollWorkbookInput(body.input), getHeader(event, 'x-ruihang-test-session'))
    return encodePayrollWorkbookRead(result)
  }
  catch (cause) { throwQuantityError(cause) }
})
