import { quantityObject } from '../../app/lib/quantity/central-decoder'
import { quantityProblemFromUnknown } from '../../app/lib/quantity/central-repository'

export function throwQuantityError(cause: unknown): never {
  const error = quantityProblemFromUnknown(quantityObject(cause) && quantityObject(cause.problem) ? { data: cause.problem } : cause)
  const code = error.problem.code
  const statusCode = code === 'forbidden'
    ? 403
    : code === 'not-found'
      ? 404
      : code === 'invalid-query'
        ? 400
        : code === 'validation-failed'
          ? 422
          : code === 'conflict' || code === 'stale-source' || code === 'relationship-mismatch'
            ? 409
            : code === 'internal-error' ? 500 : 503
  throw createError({ statusCode, statusMessage: error.message, data: error.problem })
}
