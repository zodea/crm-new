import { resolveBusinessSession } from '../../utils/business-session'
import { ourSignatoryRuntime } from '../../utils/our-signatory-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = ourSignatoryRuntime(getHeader(event, 'x-ruihang-test-session'))
    return await runtime.signatories.list(runtime.production ? productionSession(event) : () => resolveBusinessSession())
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
