import type { CommandRecoveryDescriptor, RecoveryStorage } from '../forms/command-recovery'
import type { FileRefChanges } from '../forms/file-refs'
import type { OwnerCommercialDocumentCommandContextDTO, OwnerCommercialDocumentCommandRepository, OwnerCommercialDocumentCommandRequestDTO, OwnerCommercialDocumentFormReadDTO } from './central-command-contract'
import type { OwnerCommercialDocumentKind } from './central-repository'
import type { OwnerDocumentDraft } from './forms'
import { isISODateTimeDTO } from '../../types/read-model'
import { createFormCommandActions } from '../forms/command-session'
import { ownerCommercialDocumentProblem, ownerCommercialDocumentProblemFromUnknown, OwnerCommercialDocumentRepositoryProblem } from './central-repository'
import { withOwnerDocumentFormVersion } from './form-version'

/** All document kinds reuse the existing form receipt/recovery protocol and isolate their stable kind. */
export function createOwnerDocumentCommandSession(kind: OwnerCommercialDocumentKind, repository: () => OwnerCommercialDocumentCommandRepository, recoveryStorage?: () => RecoveryStorage) {
  const capability = ['sub_change', 'sub_settlement', 'project_penalty'].includes(kind) ? 'subcontract-document:write' as const : 'owner-document:write' as const
  let deleted = false
  let verifiedDeletion: { descriptor: CommandRecoveryDescriptor, deletedAt: string } | null = null
  let pendingDescriptor: () => CommandRecoveryDescriptor | null = () => null
  const actions = createFormCommandActions<OwnerCommercialDocumentCommandContextDTO, typeof capability, OwnerDocumentDraft, OwnerCommercialDocumentCommandRequestDTO['action'], FileRefChanges, OwnerCommercialDocumentFormReadDTO, Record<string, unknown>>({
    capability,
    family: 'owner-commercial-document',
    scopeId: kind,
    recoveryStorage,
    repository: () => ({
      context: () => repository().context(kind),
      loadForm: async (id) => {
        const form = await repository().loadForm(kind, id, deleted)
        return { ...form, draft: withOwnerDocumentFormVersion(form.draft, form.version) as OwnerCommercialDocumentFormReadDTO['draft'] }
      },
      execute: async (request) => {
        const result = await repository().execute({ ...request, id: request.id ?? null, kind, requiredCapability: capability } as OwnerCommercialDocumentCommandRequestDTO)
        deleted = result.deleted
        return result
      },
      resolve: async () => {
        const descriptor = pendingDescriptor()
        if (!descriptor)
          throw new Error('原商务提交定位已丢失，请保留原编号')
        const result = await repository().resolve(kind, descriptor)
        if (result.outcome === 'applied')
          deleted = result.result.deleted
        return result
      },
    }),
    problemFromUnknown: ownerCommercialDocumentProblemFromUnknown,
    conflict: latest => Object.assign(new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem('conflict', '单据已有新版本，请保留输入并核对')), { latest }),
    validateReadContext: (form, context) => {
      if (form.kind !== kind || form.id !== form.draft.id)
        throw new Error('已保存单据的类型或稳定身份与原提交不同，请保留原编号')
      const proof = form as OwnerCommercialDocumentFormReadDTO & { workspaceId?: string, actorId?: string, dataOrigin?: string }
      const original = pendingDescriptor()
      if ((proof.workspaceId !== undefined && proof.workspaceId !== context.workspaceId)
        || (proof.actorId !== undefined && proof.actorId !== context.actorId)
        || (proof.dataOrigin !== undefined && proof.dataOrigin !== 'real')) {
        throw new Error('已保存单据的正式来源或身份变化，请保留原编号')
      }
      if (original?.action === 'delete' || form.readOnly === true || form.deletionVerification) {
        const locator = original ?? verifiedDeletion?.descriptor
        const tombstone = form.deletionVerification
        if (locator?.action !== 'delete' || locator.family !== 'owner-commercial-document' || locator.scopeId !== kind || locator.targetId !== form.id
          || locator.workspaceId !== context.workspaceId || locator.actorId !== context.actorId || form.readOnly !== true
          || !tombstone || tombstone.commandId !== locator.commandId || !isISODateTimeDTO(tombstone.deletedAt)
          || (verifiedDeletion && ((['workspaceId', 'actorId', 'family', 'scopeId', 'targetId', 'action', 'commandId'] as const).some(field => verifiedDeletion!.descriptor[field] !== locator[field]) || verifiedDeletion.deletedAt !== tombstone.deletedAt))) {
          throw new Error('归档只读凭证与同身份、同单据的原删除编号或日期不同，请保留原编号')
        }
        verifiedDeletion = { descriptor: { ...locator }, deletedAt: tombstone.deletedAt }
      }
    },
  })
  const session = actions.createSession()
  pendingDescriptor = () => session.pending?.descriptor ?? null
  return { actions, session }
}

export type OwnerDocumentCommandSession = ReturnType<typeof createOwnerDocumentCommandSession>
