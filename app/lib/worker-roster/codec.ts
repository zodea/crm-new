import type { WorkerPhotoAsset, WorkerPrivateProfile, WorkerRosterArchive, WorkerRosterContext, WorkerRosterPreview } from './contract'
import { rosterProblem, WORKER_PRIVATE_READ } from './contract'
import { parsePrivateValues, parseRosterScope, rosterId, rosterObject } from './validation'

function invalid(): never {
  return rosterProblem('unavailable', '名册服务响应不完整或归属不符，请重新读取')
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
function context(value: unknown): asserts value is WorkerRosterContext {
  if (!rosterObject(value) || !rosterId(value.workspaceId) || !rosterId(value.actorId) || value.origin !== 'real' || !strings(value.capabilities) || !value.capabilities.includes(WORKER_PRIVATE_READ))
    invalid()
}
export function decodeWorkerAsset(value: unknown, workerId: string): WorkerPhotoAsset {
  if (!rosterObject(value) || !rosterId(value.id) || value.workerId !== workerId || typeof value.fileName !== 'string' || typeof value.mimeType !== 'string' || !(value.fileSize === null || (Number.isSafeInteger(value.fileSize) && Number(value.fileSize) >= 0)) || !(value.sha256 === null || (typeof value.sha256 === 'string' && /^[\da-f]{64}$/.test(value.sha256))) || typeof value.createdAt !== 'string' || !['missing', 'available'].includes(String(value.state)) || !(value.legacyCategory === null || typeof value.legacyCategory === 'string') || (value.state === 'available' && value.sha256 === null))
    return invalid()
  return value as unknown as WorkerPhotoAsset
}
function worker(value: unknown, workerId: string) {
  if (!rosterObject(value) || value.id !== workerId || value.dataOrigin !== 'real' || !['name', 'trade', 'phone', 'idCard', 'projectStatus', 'status', 'updatedAt'].every(key => typeof value[key] === 'string') || !['crewId', 'currentProjectId', 'entryDate', 'exitDate'].every(key => value[key] === null || typeof value[key] === 'string') || !['gender', 'hometown', 'bankName', 'bankAccount', 'bankCode'].every(key => value[key] === undefined || typeof value[key] === 'string'))
    invalid()
}
export function decodeWorkerProfile(value: unknown, workerId: string): WorkerPrivateProfile {
  if (!rosterObject(value))
    return invalid()
  context(value.context)
  worker(value.worker, workerId)
  if (typeof value.sourceVersion !== 'string' || !value.sourceVersion || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.assets) || !strings(value.diagnostics))
    return invalid()
  parsePrivateValues(value.values)
  const assets = value.assets.map(asset => decodeWorkerAsset(asset, workerId))
  if (new Set(assets.map(asset => asset.id)).size !== assets.length)
    invalid()
  return structuredClone(value) as unknown as WorkerPrivateProfile
}
export function decodeRosterPreview(value: unknown): WorkerRosterPreview {
  if (!rosterObject(value))
    return invalid()
  context(value.context)
  parseRosterScope(value.scope)
  if (typeof value.sourceVersion !== 'string' || !value.sourceVersion || typeof value.projectName !== 'string' || !Array.isArray(value.members) || !value.members.length || !strings(value.diagnostics) || !rosterObject(value.counts) || !['present', 'left', 'notEntered', 'unknown'].every(key => Number.isSafeInteger((value.counts as Record<string, unknown>)[key]) && Number((value.counts as Record<string, unknown>)[key]) >= 0))
    return invalid()
  const ids = new Set<string>()
  for (const row of value.members) {
    if (!rosterObject(row) || !rosterId(row.workerId) || ids.has(row.workerId) || !strings(row.payrollNames) || !row.payrollNames.length || !strings(row.statementIds) || !row.statementIds.length || new Set(row.statementIds).size !== row.statementIds.length || row.statementIds.some(id => !(value.scope as { statementIds: string[] }).statementIds.includes(id)) || typeof row.isLeader !== 'boolean' || !strings(row.diagnostics) || !Array.isArray(row.photos) || !['present', 'left', 'not-entered', 'unknown'].includes(String(row.siteStatus)))
      invalid()
    ids.add(row.workerId)
    if (row.profile !== null) {
      worker(row.profile, row.workerId)
      if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || typeof row.sourceVersion !== 'string' || !row.sourceVersion)
        invalid()
    }
    else if (row.revision !== null || row.sourceVersion !== null || row.photos.length || row.siteStatus !== 'unknown') {
      invalid()
    }
    const values = parsePrivateValues(row.values)
    const purposes = new Set<string>()
    for (const asset of row.photos) {
      decodeWorkerAsset(asset, row.workerId)
      if (!rosterObject(asset) || !['portrait', 'bank-card'].includes(String(asset.purpose)) || purposes.has(String(asset.purpose)))
        invalid()
      if (asset.id !== (asset.purpose === 'portrait' ? values.portraitId : values.bankCardId))
        invalid()
      purposes.add(String(asset.purpose))
    }
  }
  for (const [key, status] of [['present', 'present'], ['left', 'left'], ['notEntered', 'not-entered'], ['unknown', 'unknown']] as const) {
    if (value.counts[key] !== value.members.filter(row => row.siteStatus === status).length)
      invalid()
  }
  return structuredClone(value) as unknown as WorkerRosterPreview
}
export function decodeRosterArchive(value: unknown, projectId: string, archiveId: string): WorkerRosterArchive {
  const preview = decodeRosterPreview(value)
  if (!rosterObject(value) || value.id !== archiveId || preview.scope.projectId !== projectId || value.evidenceKind !== 'dated-supplement' || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || typeof value.createdAt !== 'string' || !rosterId(value.createdBy))
    return invalid()
  return value as unknown as WorkerRosterArchive
}
