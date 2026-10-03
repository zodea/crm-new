import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { numberingExact, numberingObject } from '../../../../app/lib/payroll/central-numbering-codec'
import { isStableRouteIdentity } from '../../../../app/lib/util/stable-route-identity'
import { payrollWorkbookService } from '../../../utils/payroll-workbook-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!numberingObject(body) || !numberingExact(body, ['query', 'input']) || !numberingObject(body.query) || !numberingObject(body.input) || !numberingExact(body.input, ['projectId']) || !isStableRouteIdentity(body.input.projectId))
      throw payrollProblem('invalid-query', '工资输出目录读取格式无效')
    const result = await payrollWorkbookService.workbookArchives(parsePayrollQuery(body.query), { projectId: body.input.projectId }, getHeader(event, 'x-ruihang-test-session'))
    return result
  }
  catch (cause) { throwQuantityError(cause) }
})
