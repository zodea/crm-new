import { resolveBusinessSession } from '../../../utils/business-session'
import { parseCrewExcelPreview } from '../../../utils/crew-excel-import-request'
import { crewWorkerCommandTestInstance } from '../../../utils/crew-worker-command-test-instance'
import { productionCrewWorkerRuntime } from '../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const raw = await readBody(event)
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.previewCrewExcel(raw, productionSession(event))
    const session = resolveBusinessSession()
    return { workspaceId: session.workspaceId, actorId: session.actorId, capabilities: [...session.capabilities], previews: crewWorkerCommandTestInstance.previewCrewExcel(parseCrewExcelPreview(raw), session, getHeader(event, 'x-ruihang-test-session')) }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
