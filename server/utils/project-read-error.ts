import type { ProblemDTO } from '../../app/types/read-model'
import { CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/repository'
import { CustomerRepositoryProblem } from '../../app/lib/customer/repository'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { SupplierRepositoryProblem } from '../../app/lib/supplier/repository'

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

export function throwProjectReadError(cause: unknown): never {
  if (!(cause instanceof ProjectRepositoryProblem)
    && !(cause instanceof CustomerRepositoryProblem)
    && !(cause instanceof SupplierRepositoryProblem)
    && !(cause instanceof CrewWorkerRepositoryProblem)) {
    throw cause
  }
  throw createError({
    statusCode: STATUS_BY_CODE[cause.problem.code] ?? 500,
    statusMessage: 'Domain request failed',
    data: cause.problem,
  })
}
