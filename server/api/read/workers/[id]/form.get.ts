import { resolveBusinessSession } from '../../../../utils/business-session'
import { crewWorkerCommandTestInstance } from '../../../../utils/crew-worker-command-test-instance'
import { demoWorkspaceTestInstance } from '../../../../utils/demo-workspace-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return crewWorkerCommandTestInstance.workerForm(
      getRouterParam(event, 'id') ?? '',
      { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(getHeader(event, 'x-ruihang-test-session')) },
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
