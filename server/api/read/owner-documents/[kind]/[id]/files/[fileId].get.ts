import { Buffer } from 'node:buffer'
import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { OWNER_COMMERCIAL_DOCUMENT_KINDS } from '../../../../../../../app/lib/owner-document/central-repository'
import { productionOwnerDocumentRuntime } from '../../../../../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const kind = getRouterParam(event, 'kind') ?? ''
    if (getQuery(event).origin !== 'real' || !OWNER_COMMERCIAL_DOCUMENT_KINDS.includes(kind as typeof OWNER_COMMERCIAL_DOCUMENT_KINDS[number]))
      throw createError({ statusCode: 403, message: '原件读取须指定真实单据类型及来源' })
    const production = productionOwnerDocumentRuntime(event)
    if (!production)
      throw createError({ statusCode: 503, message: '商务原件正式来源尚未接通' })
    const original = await production.file({ kind: kind as typeof OWNER_COMMERCIAL_DOCUMENT_KINDS[number], id: getRouterParam(event, 'id') ?? '', fileId: getRouterParam(event, 'fileId') ?? '', origin: 'real' })
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    const { bytes, ...metadata } = original
    return { ...metadata, fileSize: bytes.length, payloadBase64: Buffer.from(bytes).toString('base64') }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
