import type { CommandRecoveryDescriptor } from '../../../../app/lib/forms/command-recovery'
import type { OwnerCommercialDocumentKind } from '../../../../app/lib/owner-document/central-repository'
import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { OWNER_COMMERCIAL_DOCUMENT_KINDS } from '../../../../app/lib/owner-document/central-repository'
import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { productionOwnerDocumentRuntime } from '../../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || !['commandId,kind', 'descriptor,kind'].includes(Object.keys(body).sort().join(','))
      || !('kind' in body) || !OWNER_COMMERCIAL_DOCUMENT_KINDS.includes(body.kind as OwnerCommercialDocumentKind)) {
      throw createError({ statusCode: 422, message: '核对商务单据原提交仅接受编号和单据类型' })
    }
    const kind = body.kind as OwnerCommercialDocumentKind
    const production = productionOwnerDocumentRuntime(event)
    if ('descriptor' in body) {
      const value = body.descriptor
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw createError({ statusCode: 422, message: '原提交恢复范围无效' })
      const descriptor = value as CommandRecoveryDescriptor
      if (!['action,actorId,commandId,family,scopeId,targetId,workspaceId', 'action,actorId,commandId,family,targetId,workspaceId'].includes(Object.keys(value).sort().join(','))
        || descriptor.family !== 'owner-commercial-document' || descriptor.scopeId !== kind
        || !['action', 'workspaceId', 'actorId'].every(field => typeof (value as Record<string, unknown>)[field] === 'string' && String((value as Record<string, unknown>)[field]).trim())
        || !(descriptor.targetId === null || typeof descriptor.targetId === 'string')) {
        throw createError({ statusCode: 422, message: '原提交恢复身份、单据类型或范围无效' })
      }
      parseResolveCommandBody({ commandId: descriptor.commandId })
      if (production)
        return await production.resolve(kind, descriptor)
      const session = resolveBusinessSession()
      if (descriptor.workspaceId !== session.workspaceId || descriptor.actorId !== session.actorId)
        throw createError({ statusCode: 403, message: '原提交不属于当前工作区或操作者' })
      return ownerCommercialDocumentCommandTestInstance.resolve(descriptor.commandId, kind, session, getHeader(event, 'x-ruihang-test-session'))
    }
    const commandId = parseResolveCommandBody({ commandId: 'commandId' in body ? body.commandId : undefined })
    if (production)
      return await production.resolve(kind, commandId)
    return ownerCommercialDocumentCommandTestInstance.resolve(commandId, kind, resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
