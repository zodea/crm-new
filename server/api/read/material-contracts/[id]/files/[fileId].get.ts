import { Buffer } from 'node:buffer'
import { resolveBusinessSession } from '../../../../../utils/business-session'
import { materialContractCommandTestInstance } from '../../../../../utils/material-contract-command-test-instance'
import { productionMaterialContractRuntime } from '../../../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id') ?? ''
    const fileId = getRouterParam(event, 'fileId') ?? ''
    if (getQuery(event).origin !== 'real')
      throw createError({ statusCode: 403, statusMessage: '只能从明确的正式来源读取合同原件' })
    const production = productionMaterialContractRuntime()
    const original = production
      ? await production.contracts.file(id, fileId, productionSession(event))
      : materialContractCommandTestInstance.file(id, fileId, resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return { ownerId: id, fileId, dataOrigin: 'real', fileName: original.fileName, mimeType: original.mimeType, fileSize: original.bytes.length, sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
