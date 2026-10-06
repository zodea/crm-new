import { encodePayrollHostSection } from '../../../../app/lib/crew-worker/payroll-read'
import { crewWorkerReadTestInstance } from '../../../utils/crew-worker-read-test-instance'
import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionCrewWorkerRuntime()
    if (production) {
      const detail = await production.crews.crewDetail(getRouterParam(event, 'id') ?? '', getQuery(event), productionSession(event))
      return { ...detail, payrollActual: encodePayrollHostSection(detail.payrollActual) }
    }
    const detail = await crewWorkerReadTestInstance.crewDetail(
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
