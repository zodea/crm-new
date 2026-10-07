import { Buffer } from 'node:buffer'
import { createError, defineEventHandler, getHeader, getQuery, getRouterParam, setHeader } from 'h3'
import { resolveBusinessSession } from '../../../../../utils/business-session'
import { constructionContractCommandTestInstance } from '../../../../../utils/construction-contract-command-test-instance'
import { productionConstructionContractRuntime } from '../../../../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    if (getQuery(event).origin !== 'real')
      throw createError({ statusCode: 403, statusMessage: '须明确正式来源才能读取施工合同原件' })
    const formal = productionConstructionContractRuntime()
    const id = getRouterParam(event, 'id') ?? ''
    const fileId = getRouterParam(event, 'fileId') ?? ''
    if (formal) {
      const original = await formal.contracts.file(id, fileId, 'real', productionSession(event))
      setHeader(event, 'Cache-Control', 'private, no-store')
      setHeader(event, 'X-Content-Type-Options', 'nosniff')
      return { ownerId: id, fileId, dataOrigin: 'real', fileName: original.fileName, mimeType: original.mimeType, fileSize: original.bytes.length, sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') }
    }
    const result = constructionContractCommandTestInstance.readFileContent(
      getRouterParam(event, 'id') ?? '',
      getRouterParam(event, 'fileId') ?? '',
      resolveBusinessSession(event),
      getHeader(event, 'x-ruihang-test-session'),
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
