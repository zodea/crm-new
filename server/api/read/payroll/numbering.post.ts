import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { encodePayrollNumberingRead, numberingExact, numberingObject, parsePayrollNumberingInput } from '../../../../app/lib/payroll/central-numbering-codec'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!numberingObject(body) || !numberingExact(body, ['query', 'input']) || !numberingObject(body.query))
      throw payrollProblem('invalid-query', '正式编号读取格式无效')
    return encodePayrollNumberingRead(await payrollService.numbering(parsePayrollQuery(body.query), parsePayrollNumberingInput(body.input), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
