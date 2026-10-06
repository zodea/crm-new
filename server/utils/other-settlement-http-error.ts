import { FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { MigrationEvidenceProblem } from './migration-snapshot'
import { throwProductionStorageError } from './production-runtime'
import { throwProjectReadError } from './project-read-error'

export function throwOtherSettlementHttpError(cause: unknown): never {
  throwProductionStorageError(cause)
  if (cause instanceof FinanceRepositoryProblem || cause instanceof MigrationEvidenceProblem)
    throw createError({ statusCode: ({ 'forbidden': 403, 'validation-failed': 422, 'conflict': 409, 'not-found': 404 } as Record<string, number>)[cause.problem.code] ?? 503, statusMessage: 'Other settlement unavailable', data: cause.problem })
  return throwProjectReadError(cause)
}
