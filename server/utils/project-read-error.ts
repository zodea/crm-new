import type { ProblemDTO } from '../../app/types/read-model'
import { AuxiliaryContractProblem } from '../../app/lib/auxiliary-contract/contract'
import { ConstructionContractRepositoryProblem } from '../../app/lib/construction-contract/repository'
import { CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/repository'
import { CustomerRepositoryProblem } from '../../app/lib/customer/repository'
import { MaterialContractRepositoryProblem } from '../../app/lib/material-contract/repository'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { OwnerCommercialDocumentRepositoryProblem } from '../../app/lib/owner-document/central-repository'
import { ProjectSupplierRepositoryProblem } from '../../app/lib/project-supplier/repository'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { QuantityRepositoryProblem } from '../../app/lib/quantity/central-contract'
import { ReceiptRepositoryProblem } from '../../app/lib/receipt/contract'
import { SubcontractContractRepositoryProblem } from '../../app/lib/subcontract-contract/repository'
import { SupplierRepositoryProblem } from '../../app/lib/supplier/repository'

const STATUS_BY_CODE: Partial<Record<ProblemDTO['code'], number>> = {
  'invalid-query': 400,
  'unauthenticated': 401,
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
    && !(cause instanceof OurSignatoryRepositoryProblem)
    && !(cause instanceof AuxiliaryContractProblem)
    && !(cause instanceof ConstructionContractRepositoryProblem)
    && !(cause instanceof CustomerRepositoryProblem)
    && !(cause instanceof SupplierRepositoryProblem)
    && !(cause instanceof ReceiptRepositoryProblem)
    && !(cause instanceof QuantityRepositoryProblem)
    && !(cause instanceof ProjectSupplierRepositoryProblem)
    && !(cause instanceof CrewWorkerRepositoryProblem)
    && !(cause instanceof MaterialContractRepositoryProblem)
    && !(cause instanceof OwnerCommercialDocumentRepositoryProblem)
    && !(cause instanceof SubcontractContractRepositoryProblem)) {
    throw cause
  }
  throw createError({
    statusCode: STATUS_BY_CODE[cause.problem.code] ?? 500,
    statusMessage: 'Domain request failed',
    data: cause.problem,
  })
}
