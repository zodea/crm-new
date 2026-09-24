import { encodePayrollHostSection } from '../../../../app/lib/crew-worker/payroll-read'
import { crewWorkerReadTestInstance } from '../../../utils/crew-worker-read-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const detail = await crewWorkerReadTestInstance.workerDetail(
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
