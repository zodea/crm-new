import { payrollProblem } from '../../../app/lib/payroll/central-contract'
import { numberingExact, numberingObject } from '../../../app/lib/payroll/central-numbering-codec'
import { isStableRouteIdentity } from '../../../app/lib/util/stable-route-identity'
import { payrollWorkbookService } from '../../utils/payroll-workbook-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!numberingObject(body) || !numberingExact(body, ['commandId', 'projectId']) || !isStableRouteIdentity(body.commandId) || !isStableRouteIdentity(body.projectId))
      throw payrollProblem('invalid-query', '原目录提交核验格式无效')
    return await payrollWorkbookService.resolveWorkbook(body.commandId, body.projectId, getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
