import type { OwnerDocumentDraft } from './forms'
import { ownerDocumentStatusIsEditable } from './forms'

const VERSION_FIELD = '_centralBaseVersion' as const
const SERVER_OWNED_FIELDS = new Set([
  'id',
  'status',
  'sourceType',
  'sourceId',
  'sourceLocked',
  'approvalDate',
  'submittedAt',
  'quantityBasis',
  'quantitySourceVersion',
  'quantitySourceUpdatedAt',
  'auditedAmount',
  'auditDifference',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'version',
])

export function withOwnerDocumentFormVersion(draft: OwnerDocumentDraft, version: string): OwnerDocumentDraft {
  return { ...draft, [VERSION_FIELD]: version }
}

export function requireOwnerDocumentFormVersion(draft: OwnerDocumentDraft): string {
  const version = draft[VERSION_FIELD]
  if (typeof version !== 'string' || !version)
    throw new Error('表单版本已丢失，请重新读取后再操作')
  return version
}

export function advanceOwnerDocumentFormVersion(draft: OwnerDocumentDraft, version: string): void {
  requireOwnerDocumentFormVersion(draft)
  draft[VERSION_FIELD] = version
}

export function initializeOwnerDocumentFormVersion(draft: OwnerDocumentDraft, version: string): void {
  if (!version)
    throw new Error('表单版本无效')
  draft[VERSION_FIELD] = version
}

export function ownerDocumentFormCanRebase(
  localDraft: OwnerDocumentDraft,
  latestDraft: OwnerDocumentDraft,
): boolean {
  const localStatus = String(localDraft.status ?? '')
  const latestStatus = String(latestDraft.status ?? '')
  return localStatus === latestStatus
    || (ownerDocumentStatusIsEditable(localStatus) && ownerDocumentStatusIsEditable(latestStatus))
}

export function rebaseOwnerDocumentFormVersion(
  localDraft: OwnerDocumentDraft,
  latestDraft: OwnerDocumentDraft,
): OwnerDocumentDraft {
  const latestVersion = requireOwnerDocumentFormVersion(latestDraft)
  if (!ownerDocumentFormCanRebase(localDraft, latestDraft))
    return withOwnerDocumentFormVersion({ ...latestDraft }, latestVersion)

  const localBusinessFields = Object.fromEntries(
    Object.entries(localDraft).filter(([field]) => !field.startsWith('_') && !SERVER_OWNED_FIELDS.has(field)),
  )
  return withOwnerDocumentFormVersion(
    { ...latestDraft, ...localBusinessFields },
    latestVersion,
  )
}
