import { isQuantityBasis } from '../../../../app/lib/quantity/basis'
import { quantityProblem } from '../../../../app/lib/quantity/central-contract'
import { resolveBusinessSession } from '../../../utils/business-session'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { productionOwnerDocumentRuntime } from '../../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const production = productionOwnerDocumentRuntime(event)
    if (production)
      return await production.boqLines({ projectId: String(query.projectId ?? ''), contractId: String(query.contractId ?? ''), periodNo: String(query.periodNo ?? ''), quantityBasis: query.quantityBasis ?? 'field' })
    ownerCommercialDocumentCommandTestInstance.context(
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
      'owner_change',
    )
    const projectId = String(query.projectId ?? '')
    const contractId = String(query.contractId ?? '')
    const periodNo = String(query.periodNo ?? '')
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    if (periodNo) {
      const basis = query.quantityBasis ?? 'field'
      if (!isQuantityBasis(basis))
        throw quantityProblem('invalid-query', '取数基准只能是合同量、暂估量或现场复核量')
      return await quantityTestInstance.withMonthly({ projectId, origin: 'real', includeDemo: false, basis, periodNo }, facts =>
        ownerCommercialDocumentCommandTestInstance.boqLinesFor(projectId, contractId, periodNo, sessionId, facts), sessionId)
    }
    return ownerCommercialDocumentCommandTestInstance.boqLinesFor(
      projectId,
      contractId,
      periodNo,
      sessionId,
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
