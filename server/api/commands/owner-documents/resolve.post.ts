import type { OwnerCommercialDocumentKind } from '../../../../app/lib/owner-document/central-repository'
import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { OWNER_COMMERCIAL_DOCUMENT_KINDS } from '../../../../app/lib/owner-document/central-repository'
import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
      || !('commandId' in body) || !('kind' in body) || !OWNER_COMMERCIAL_DOCUMENT_KINDS.includes(body.kind as OwnerCommercialDocumentKind)) {
      throw createError({ statusCode: 422, message: '核对商务单据原提交仅接受编号和单据类型' })
    }
    const commandId = parseResolveCommandBody({ commandId: body.commandId })
    return ownerCommercialDocumentCommandTestInstance.resolve(commandId, body.kind as OwnerCommercialDocumentKind, resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
