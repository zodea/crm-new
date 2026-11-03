import { resolveBusinessSession } from '../../../utils/business-session'
import { crewWorkerCommandTestInstance } from '../../../utils/crew-worker-command-test-instance'
import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseWorkerExcelImport } from '../../../utils/worker-excel-import-request'

export default defineEventHandler(async (event) => {
  try {
    const raw = await readBody(event)
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.importWorkerExcel(raw, productionSession(event))
    return await crewWorkerCommandTestInstance.importWorkerExcel(parseWorkerExcelImport(raw), resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
