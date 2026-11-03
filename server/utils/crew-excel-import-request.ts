import type { CrewExcelDraft, CrewExcelImportCommand } from '../../app/lib/crew-worker/excel-import-contract'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/read-contract'
import { parseCrewCommandRequest } from './crew-worker-command-request'

const fields = new Set(['name', 'trade', 'capabilityTrades', 'capabilityItems', 'contactName', 'contactPhone', 'defaultPayRatio', 'rentSubsidyEnabled', 'rentSubsidyPrice', 'mgmtFeeEnabled', 'mgmtFeePrice', 'assignmentLevel', 'note'])
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function fail(): never {
  throw new CrewWorkerRepositoryProblem(crewWorkerProblem('validation-failed', '班组导入请求无效'))
}
function draft(value: unknown): CrewExcelDraft {
  if (!object(value) || Object.keys(value).some(key => !fields.has(key)) || typeof value.name !== 'string' || !value.name.trim()
    || (value.assignmentLevel !== undefined && !['crew', 'worker'].includes(String(value.assignmentLevel)))) {
    return fail()
  }
  return parseCrewCommandRequest({ workspaceId: 'preview', actorId: 'preview', requiredCapability: 'crew:write', commandId: 'preview', baseVersion: null, action: 'draft', draft: value, attachments: {} }).draft
}
export function parseCrewExcelPreview(value: unknown): CrewExcelDraft[] {
  if (!object(value) || Object.keys(value).some(key => key !== 'drafts') || !Array.isArray(value.drafts) || value.drafts.length > 5000)
    return fail()
  return value.drafts.map(draft)
}
export function parseCrewExcelImport(value: unknown): CrewExcelImportCommand {
  if (!object(value) || Object.keys(value).some(key => !['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'draft', 'decision'].includes(key))
    || typeof value.workspaceId !== 'string' || !value.workspaceId || typeof value.actorId !== 'string' || !value.actorId
    || value.requiredCapability !== 'crew:write' || typeof value.commandId !== 'string' || !/^[A-Z0-9][\w-]{2,79}$/i.test(value.commandId)
    || !object(value.decision) || !['create', 'replace'].includes(String(value.decision.kind))
    || typeof value.decision.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.decision.fingerprint)) {
    return fail()
  }
  const decision = value.decision
  if (decision.kind === 'create') {
    if (Object.keys(decision).some(key => !['kind', 'fingerprint'].includes(key)))
      return fail()
    return { workspaceId: value.workspaceId, actorId: value.actorId, requiredCapability: 'crew:write', commandId: value.commandId, draft: draft(value.draft), decision: { kind: 'create', fingerprint: decision.fingerprint as string } }
  }
  if (Object.keys(decision).some(key => !['kind', 'fingerprint', 'id', 'version'].includes(key)) || typeof decision.id !== 'string' || !decision.id || typeof decision.version !== 'string' || !/^[1-9]\d*$/.test(decision.version))
    return fail()
  return { workspaceId: value.workspaceId, actorId: value.actorId, requiredCapability: 'crew:write', commandId: value.commandId, draft: draft(value.draft), decision: { kind: 'replace', fingerprint: decision.fingerprint as string, id: decision.id, version: decision.version } }
}
