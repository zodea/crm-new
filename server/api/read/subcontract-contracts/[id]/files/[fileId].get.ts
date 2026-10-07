import { Buffer } from 'node:buffer'
import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { resolveBusinessSession } from '../../../../../utils/business-session'
import { productionSession, throwProductionStorageError } from '../../../../../utils/production-runtime'
import { productionSubcontractContractRuntime } from '../../../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../../../utils/project-read-error'
import { subcontractContractCommandTestInstance } from '../../../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionSubcontractContractRuntime()
    if (formal) {
      if (getQuery(event).origin !== 'real')
        throw createError({ statusCode: 403, statusMessage: '须明确真实来源才能读取分包原件' })
      const id = getRouterParam(event, 'id') ?? ''
      const fileId = getRouterParam(event, 'fileId') ?? ''
      const result = await formal.contracts.file(id, fileId, 'real', productionSession(event))
      setHeader(event, 'Cache-Control', 'private, no-store')
      setHeader(event, 'X-Content-Type-Options', 'nosniff')
      return { ownerId: id, fileId, dataOrigin: 'real' as const, fileName: result.fileName, mimeType: result.mimeType, fileSize: result.bytes.length, sha256: result.sha256, payloadBase64: Buffer.from(result.bytes).toString('base64') }
    }
    if (getQuery(event).origin !== 'real')
      throw createError({ statusCode: 403, statusMessage: '须明确正式来源才能读取分包合同原件' })
    const result = subcontractContractCommandTestInstance.readFileContent(
      getRouterParam(event, 'id') ?? '',
      getRouterParam(event, 'fileId') ?? '',
      resolveBusinessSession(event),
    )
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return result
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
