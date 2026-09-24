import { encodePayrollHostSection } from '../../../../app/lib/crew-worker/payroll-read'
import { productionProjectRuntime } from '../../../utils/production-project-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { projectReadTestInstance } from '../../../utils/project-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionProjectRuntime()
    if (runtime)
      return await runtime.projects.detail(getRouterParam(event, 'id') ?? '', getQuery(event), productionSession(event))
    const detail = await projectReadTestInstance.detail(
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
    return { ...detail, payrollActual: detail.payrollActual && encodePayrollHostSection(detail.payrollActual) }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
