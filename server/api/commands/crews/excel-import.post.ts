import { resolveBusinessSession } from '../../../utils/business-session'
import { parseCrewExcelImport } from '../../../utils/crew-excel-import-request'
import { crewWorkerCommandTestInstance } from '../../../utils/crew-worker-command-test-instance'
import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const raw = await readBody(event)
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.importCrewExcel(raw, productionSession(event))
    return await crewWorkerCommandTestInstance.importCrewExcel(parseCrewExcelImport(raw), resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
