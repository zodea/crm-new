import { resolveBusinessSession } from '../../../utils/business-session'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { productionOwnerDocumentRuntime } from '../../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const kind = getQuery(event).kind
    if (kind !== undefined && kind !== 'owner_change' && kind !== 'owner_report' && kind !== 'acceptance'
      && kind !== 'final_settlement' && kind !== 'owner_penalty' && kind !== 'sub_change' && kind !== 'sub_settlement' && kind !== 'project_penalty') {
      throw new Error('甲方商务单据类型无效')
    }
    const production = productionOwnerDocumentRuntime(event)
    if (production)
      return await production.context(kind)
    return ownerCommercialDocumentCommandTestInstance.context(
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
      kind,
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
