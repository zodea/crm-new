import type { ProblemDTO } from '../../../app/types/read-model'
import { ProjectRepositoryProblem } from '../../../app/lib/project/repository'
import { projectReadTestInstance } from '../../utils/project-read-test-instance'

const STATUS_BY_CODE: Partial<Record<ProblemDTO['code'], number>> = {
  'invalid-query': 400,
  'forbidden': 403,
  'not-found': 404,
  'relationship-mismatch': 404,
  'stale-source': 409,
  'conflict': 409,
  'validation-failed': 422,
  'unavailable': 503,
}

export default defineEventHandler(async (event) => {
  try {
    return await projectReadTestInstance.list(
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    if (!(cause instanceof ProjectRepositoryProblem))
      throw cause
    throw createError({
      statusCode: STATUS_BY_CODE[cause.problem.code] ?? 500,
      statusMessage: 'Project read failed',
      data: cause.problem,
    })
  }
})
