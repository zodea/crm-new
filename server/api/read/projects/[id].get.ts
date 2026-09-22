import { encodePayrollHostSection } from '../../../../app/lib/crew-worker/payroll-read'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { projectReadTestInstance } from '../../../utils/project-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const detail = await projectReadTestInstance.detail(
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
    return { ...detail, payrollActual: detail.payrollActual && encodePayrollHostSection(detail.payrollActual) }
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
