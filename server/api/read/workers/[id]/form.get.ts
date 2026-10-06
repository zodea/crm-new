import { resolveBusinessSession } from '../../../../utils/business-session'
import { crewWorkerCommandTestInstance } from '../../../../utils/crew-worker-command-test-instance'
import { demoWorkspaceTestInstance } from '../../../../utils/demo-workspace-test-instance'
import { productionCrewWorkerRuntime } from '../../../../utils/production-crew-worker-runtime'
import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionCrewWorkerRuntime()
    if (production)
      return await production.crews.workerForm(getRouterParam(event, 'id') ?? '', productionSession(event))
    return crewWorkerCommandTestInstance.workerForm(
      getRouterParam(event, 'id') ?? '',
      { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(getHeader(event, 'x-ruihang-test-session')) },
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
