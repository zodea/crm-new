import type { MoneyDTO } from '../../types/read-model'
import type { CommandRecoveryDescriptor, CommandResolution } from '../forms/command-recovery'
import type { FileRefDraft } from '../forms/file-refs'
import type { OwnerCommercialDocumentKind } from './central-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import { problemFromHttpFailure } from '../read-model/problem'
import { ownerCommercialDocumentProblem, OwnerCommercialDocumentRepositoryProblem } from './central-repository'

export type OwnerDocumentReferenceKind = 'project' | 'customer' | 'supplier' | 'crew' | 'construction' | 'subcontract' | 'auxiliary' | 'other-settlement'
export interface OwnerDocumentReferenceSelection { kind: OwnerDocumentReferenceKind, legacyId: string, id: string, version: string }
export interface OwnerDocumentMigrationCommand {
  workspaceId: string
  actorId: string
  commandId: string
  source: { sha256: string, payloadBase64: string }
  selections: OwnerDocumentReferenceSelection[]
  originals: Array<{ fileId: string, file: FileRefDraft }>
}
export interface OwnerDocumentMigrationPreview {
  workspaceId: string
  actorId: string
  sourceSha256: string
  schemaVersion: number
  documents: Array<{ kind: OwnerCommercialDocumentKind, id: string, no: string, status: string, deleted: boolean, amount: MoneyDTO | null }>
  references: Array<{ kind: OwnerDocumentReferenceKind, legacyId: string, label: string, candidates: Array<{ id: string, label: string, version: string }>, adoptedId: string | null }>
  originals: Array<{ fileId: string, fileName: string, filePath: string, fileSize: number | null, required: boolean, bodyState: 'embedded' | 'external-required' | 'metadata-only' }>
  reusedOwnerChanges: string[]
}
export interface OwnerDocumentMigrationResult {
  workspaceId: string
  actorId: string
  commandId: string
  sourceSha256: string
  importId: string
  documentIds: string[]
  restored: boolean
}
export interface OwnerDocumentMigrationState {
  workspaceId: string
  actorId: string
  capabilities: string[]
  sources: Array<{ importId: string, sourceSha256: string, importedAt: string, restored: boolean, original: OwnerDocumentMigrationResult }>
}
export function ownerDocumentMigrationDescriptor(command: Pick<OwnerDocumentMigrationCommand, 'workspaceId' | 'actorId' | 'commandId'> & { sourceSha256: string, importId?: string }): CommandRecoveryDescriptor {
  return {
    workspaceId: command.workspaceId,
    actorId: command.actorId,
    commandId: command.commandId,
    family: 'owner-document-import',
    action: command.importId ? 'restore' : 'adopt',
    targetId: command.importId ?? command.sourceSha256,
    scopeId: command.sourceSha256,
  }
}
type Fetcher = (path: string, options?: { method?: 'POST', body?: Record<string, unknown> }) => Promise<unknown>
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/[\s/\\?#]/.test(value)
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const finite = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))
const money = (value: unknown) => value === null || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))
const unique = (rows: Record<string, unknown>[], key: (row: Record<string, unknown>) => string) => new Set(rows.map(key)).size === rows.length
const kinds = ['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty', 'sub_change', 'sub_settlement', 'project_penalty']
const referenceKinds = ['project', 'customer', 'supplier', 'crew', 'construction', 'subcontract', 'auxiliary', 'other-settlement']
function unavailable(message: string): never {
  throw new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem('unavailable', message))
}
export function createOwnerDocumentMigrationRepository(fetcher: Fetcher) {
  async function request<T>(path: string, options: Parameters<Fetcher>[1], decode: (value: unknown) => T): Promise<T> {
    try {
      return decode(await fetcher(path, options))
    }
    catch (cause) {
      const problem = problemFromHttpFailure(cause)
      if (problem)
        throw new OwnerCommercialDocumentRepositoryProblem(problem, { cause })
      throw cause
    }
  }
  function result(value: unknown, fixed: { workspaceId: string, actorId: string, commandId: string, sourceSha256: string, importId?: string, restored: boolean }): OwnerDocumentMigrationResult {
    if (!object(value) || ['workspaceId', 'actorId', 'commandId', 'sourceSha256', 'restored'].some(key => value[key] !== fixed[key as keyof typeof fixed])
      || !id(value.importId) || (fixed.importId && value.importId !== fixed.importId)
      || !sha(value.sourceSha256) || !id(value.commandId)
      || !Array.isArray(value.documentIds) || value.documentIds.some(value => !id(value)) || new Set(value.documentIds).size !== value.documentIds.length) {
      return unavailable('商务整批回执与原编号、实际来源或批次不同，保留原编号')
    }
    return structuredClone(value) as unknown as OwnerDocumentMigrationResult
  }
  return {
    state: () => request('/api/read/owner-documents/import', undefined, (value): OwnerDocumentMigrationState => {
      if (!object(value) || !id(value.workspaceId) || !id(value.actorId) || !Array.isArray(value.capabilities) || value.capabilities.some(capability => typeof capability !== 'string' || !capability)
        || !Array.isArray(value.sources) || value.sources.some(row => !object(row) || !id(row.importId) || !sha(row.sourceSha256) || typeof row.restored !== 'boolean' || !isISODateTimeDTO(row.importedAt) || !object(row.original))
        || !unique(value.sources as Record<string, unknown>[], row => String(row.importId))) {
        return unavailable('商务实际采用状态未可靠读取')
      }
      const read = value as unknown as OwnerDocumentMigrationState
      for (const row of read.sources) result(row.original, { workspaceId: read.workspaceId, actorId: read.actorId, commandId: row.original.commandId, sourceSha256: row.sourceSha256, importId: row.importId, restored: false })
      return structuredClone(read)
    }),
    preflight: (command: OwnerDocumentMigrationCommand) => request('/api/commands/owner-documents/import/preflight', { method: 'POST', body: { ...command } }, (value): OwnerDocumentMigrationPreview => {
      if (!object(value) || value.workspaceId !== command.workspaceId || value.actorId !== command.actorId || value.sourceSha256 !== command.source.sha256
        || !Number.isSafeInteger(value.schemaVersion) || Number(value.schemaVersion) < 47 || Number(value.schemaVersion) > 60
        || !Array.isArray(value.documents) || value.documents.some(row => !object(row) || !kinds.includes(String(row.kind)) || !id(row.id) || typeof row.no !== 'string' || typeof row.status !== 'string' || typeof row.deleted !== 'boolean' || !money(row.amount))
        || !Array.isArray(value.references) || value.references.some(row => !object(row) || !referenceKinds.includes(String(row.kind)) || !id(row.legacyId) || typeof row.label !== 'string' || !(row.adoptedId === null || id(row.adoptedId)) || !Array.isArray(row.candidates) || row.candidates.some(candidate => !object(candidate) || !id(candidate.id) || typeof candidate.label !== 'string' || typeof candidate.version !== 'string' || !candidate.version))
        || !Array.isArray(value.originals) || value.originals.some(row => !object(row) || !id(row.fileId) || typeof row.fileName !== 'string' || !row.fileName || typeof row.filePath !== 'string' || !finite(row.fileSize) || (row.fileSize !== null && (!Number.isSafeInteger(row.fileSize) || Number(row.fileSize) < 0)) || typeof row.required !== 'boolean' || !['embedded', 'external-required', 'metadata-only'].includes(String(row.bodyState)) || row.required !== (row.bodyState === 'external-required'))
        || !Array.isArray(value.reusedOwnerChanges) || value.reusedOwnerChanges.some(value => !id(value))
        || !unique(value.documents as Record<string, unknown>[], row => `${row.kind}:${row.id}`) || !unique(value.references as Record<string, unknown>[], row => `${row.kind}:${row.legacyId}`) || !unique(value.originals as Record<string, unknown>[], row => String(row.fileId))) {
        return unavailable('商务预检与同一实际来源、身份或完整图不一致')
      }
      return value as unknown as OwnerDocumentMigrationPreview
    }),
    adopt: (command: OwnerDocumentMigrationCommand) => request('/api/commands/owner-documents/import', { method: 'POST', body: { ...command } }, value => result(value, { ...command, sourceSha256: command.source.sha256, restored: false })),
    restore: (command: { workspaceId: string, actorId: string, commandId: string, sourceSha256: string, importId: string }) => request('/api/commands/owner-documents/import/restore', { method: 'POST', body: command }, value => result(value, { ...command, restored: true })),
    resolve: (descriptor: CommandRecoveryDescriptor) => request('/api/commands/owner-documents/import/resolve', { method: 'POST', body: { ...descriptor } }, (value): CommandResolution<OwnerDocumentMigrationResult> => {
      if (object(value) && value.outcome === 'not-applied' && value.commandId === descriptor.commandId)
        return { outcome: 'not-applied', commandId: descriptor.commandId }
      if (!object(value) || value.outcome !== 'applied')
        return unavailable('原商务迁入结果不能核对，保留原编号')
      return { outcome: 'applied', result: result(value.result, { ...descriptor, sourceSha256: descriptor.scopeId!, restored: descriptor.action === 'restore', ...(descriptor.action === 'restore' ? { importId: descriptor.targetId! } : {}) }) }
    }),
  }
}
