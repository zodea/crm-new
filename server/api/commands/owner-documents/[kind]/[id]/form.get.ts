import { resolveBusinessSession } from '../../../../../utils/business-session'
import { ownerCommercialDocumentCommandTestInstance } from '../../../../../utils/owner-commercial-document-command-test-instance'
import { throwProjectReadError } from '../../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    const kind = getRouterParam(event, 'kind')
    if (kind !== 'owner_change' && kind !== 'owner_report' && kind !== 'acceptance'
      && kind !== 'final_settlement' && kind !== 'owner_penalty') {
      throw new Error('甲方商务单据类型无效')
    }
    return ownerCommercialDocumentCommandTestInstance.form(
      kind,
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
