import type { WorkerExcelDraft, WorkerExcelImportCommand } from '../../app/lib/crew-worker/worker-excel-contract'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/read-contract'
import { isISODateDTO } from '../../app/types/read-model'
import { parseWorkerCommandRequest } from './crew-worker-command-request'

const fields = new Set(['name', 'gender', 'idCard', 'phone', 'hometown', 'emergencyContact', 'emergencyPhone', 'bankName', 'bankAccount', 'bankCode', 'trade', 'capabilityTrades', 'capabilityItems', 'skillLevel', 'dailyWage', 'crewName', 'projectName', 'projectStatus', 'entryDate', 'exitDate', 'safetyEducation', 'note'])
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function fail(): never {
  throw new CrewWorkerRepositoryProblem(crewWorkerProblem('validation-failed', '工人导入请求无效'))
}
function draft(value: unknown): WorkerExcelDraft {
  if (!object(value) || Object.keys(value).some(key => !fields.has(key)) || typeof value.name !== 'string' || !value.name.trim())
    return fail()
  if (['crewName', 'projectName'].some(key => Object.hasOwn(value, key) && (typeof value[key] !== 'string' || !(value[key] as string).trim())))
    return fail()
  if (['entryDate', 'exitDate'].some(key => Object.hasOwn(value, key) && value[key] !== '' && !isISODateDTO(value[key])))
    return fail()
  const { crewName, projectName, ...worker } = value
  parseWorkerCommandRequest({ workspaceId: 'preview', actorId: 'preview', requiredCapability: 'worker:write', commandId: 'preview', baseVersion: null, action: 'draft', draft: worker, attachments: {} })
  return { ...worker, ...(crewName ? { crewName } : {}), ...(projectName ? { projectName } : {}) } as WorkerExcelDraft
}
export function parseWorkerExcelPreview(value: unknown): WorkerExcelDraft[] {
  if (!object(value) || Object.keys(value).some(key => key !== 'drafts') || !Array.isArray(value.drafts) || value.drafts.length > 5000)
    return fail()
  return value.drafts.map(draft)
}
export function parseWorkerExcelImport(value: unknown): WorkerExcelImportCommand {
  if (!object(value) || Object.keys(value).some(key => !['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'draft', 'decision'].includes(key))
    || typeof value.workspaceId !== 'string' || !value.workspaceId || typeof value.actorId !== 'string' || !value.actorId
    || value.requiredCapability !== 'worker:write' || typeof value.commandId !== 'string' || !/^[A-Z0-9][\w-]{2,79}$/i.test(value.commandId)
    || !object(value.decision) || !['create', 'replace'].includes(String(value.decision.kind)) || typeof value.decision.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.decision.fingerprint)) {
    return fail()
  }
  const decision = value.decision
  if (Object.keys(decision).some(key => !['kind', 'fingerprint', 'id', 'version', 'crew', 'project'].includes(key)))
    return fail()
  if (decision.kind === 'replace' ? typeof decision.id !== 'string' || !decision.id || typeof decision.version !== 'string' || !/^[1-9]\d*$/.test(decision.version) : decision.id !== undefined || decision.version !== undefined)
    return fail()
  for (const key of ['crew', 'project']) {
    const ref = decision[key]
    if (ref !== undefined && (!object(ref) || Object.keys(ref).sort().join(',') !== 'id,version' || typeof ref.id !== 'string' || !ref.id || typeof ref.version !== 'string' || !ref.version))
      return fail()
  }
  return { workspaceId: value.workspaceId, actorId: value.actorId, requiredCapability: 'worker:write', commandId: value.commandId, draft: draft(value.draft), decision: decision as unknown as WorkerExcelImportCommand['decision'] }
}
