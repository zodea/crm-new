import type { ProjectLifecycleCommand } from '../../../../../app/lib/project/production-contract'
import { requireProductionProjects } from '../../../../utils/production-project-runtime'
import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const body: ProjectLifecycleCommand = await readBody(event)
    if (body?.id !== getRouterParam(event, 'id'))
      throw createError({ statusCode: 422, statusMessage: 'Project identity mismatch' })
    return await requireProductionProjects().executeLifecycle(body, productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
