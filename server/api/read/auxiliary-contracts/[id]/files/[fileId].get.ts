import { auxiliaryProblem } from '../../../../../../app/lib/auxiliary-contract/contract'
import { productionAuxiliaryContractRuntime } from '../../../../../utils/production-auxiliary-contract-service'
import { productionSession, throwProductionStorageError } from '../../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    if (getQuery(event).origin !== 'real')
      throw auxiliaryProblem('forbidden', '原件下载须明确真实来源')
    const runtime = productionAuxiliaryContractRuntime()
    if (!runtime)
      throw auxiliaryProblem('unavailable', '开发验证附件仅有目录，没有可靠原正文')
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return await runtime.contracts.file(getRouterParam(event, 'id') ?? '', getRouterParam(event, 'fileId') ?? '', productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
