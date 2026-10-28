import { createHash } from 'node:crypto'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { quantityCanonical } from './production-quantity-record'

/** One unchanged canonical digest for this owner's original intents, evidence and actual dependency parts. */
export const productionBoqFingerprint = (value: unknown) => createHash('sha256').update(quantityCanonical(value)).digest('hex')
export function productionBoqFailure(code: Parameters<typeof quantityProblem>[0], message: string): never {
  throw quantityProblem(code, message)
}
