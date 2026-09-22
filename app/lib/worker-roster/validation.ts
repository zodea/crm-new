import type { WorkerPrivateValues, WorkerRosterCommand, WorkerRosterScope } from './contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { rosterProblem } from './contract'

export function rosterObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function rosterId(value: unknown): value is string {
  // Central payroll migration URI-encodes legacy IDs, which can expand beyond 256 characters.
  return isStableRouteIdentity(value) || (typeof value === 'string' && value.length <= 1024 && /^(?:[\w.~:/-]|%[a-f\d]{2})+$/i.test(value))
}
export function rosterDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every(key => allowed.includes(key))
}
export function parseRosterScope(value: unknown): WorkerRosterScope {
  if (!rosterObject(value) || !keys(value, ['projectId', 'statementIds', 'registeredOn']) || !rosterId(value.projectId) || !rosterDate(value.registeredOn) || !Array.isArray(value.statementIds) || !value.statementIds.length || value.statementIds.length > 1000 || !value.statementIds.every(rosterId) || new Set(value.statementIds).size !== value.statementIds.length)
    return rosterProblem('validation-failed', '名册项目、工资范围或登记日期无效')
  return { projectId: value.projectId, registeredOn: value.registeredOn, statementIds: [...value.statementIds].sort() }
}
export function parsePrivateValues(value: unknown): WorkerPrivateValues {
  if (!rosterObject(value) || !keys(value, ['laborContractSigned', 'laborContractSignedOn', 'portraitId', 'bankCardId']) || ![true, false, null].includes(value.laborContractSigned as boolean | null) || !(value.laborContractSignedOn === null || rosterDate(value.laborContractSignedOn)) || !(value.portraitId === null || rosterId(value.portraitId)) || !(value.bankCardId === null || rosterId(value.bankCardId)) || (value.laborContractSigned !== true && value.laborContractSignedOn !== null))
    return rosterProblem('validation-failed', '劳动合同事实或照片引用无效；未签订不能填写签订日期')
  return value as unknown as WorkerPrivateValues
}
export function parseRosterCommand(value: unknown): WorkerRosterCommand {
  if (!rosterObject(value) || !['commandId', 'workspaceId', 'actorId'].every(key => rosterId(value[key])) || value.origin !== 'real' || typeof value.sourceVersion !== 'string' || !value.sourceVersion || value.sourceVersion.length > 500)
    return rosterProblem('validation-failed', '名册提交身份或来源无效')
  const common = ['commandId', 'workspaceId', 'actorId', 'origin', 'sourceVersion', 'action']
  if (value.action === 'archive') {
    if (!keys(value, [...common, 'scope']))
      return rosterProblem('validation-failed', '名册归档含有未授权字段')
    return { ...value, scope: parseRosterScope(value.scope) } as WorkerRosterCommand
  }
  if (value.action !== 'save-profile' || !keys(value, [...common, 'workerId', 'values', 'uploads']) || !rosterId(value.workerId) || !rosterObject(value.uploads) || !keys(value.uploads, ['portrait', 'bank-card']))
    return rosterProblem('validation-failed', '工人资料提交无效')
  const values = parsePrivateValues(value.values)
  for (const photo of Object.values(value.uploads)) {
    if (!rosterObject(photo) || !keys(photo, ['fileName', 'mimeType', 'fileSize', 'payloadBase64']) || typeof photo.fileName !== 'string' || !photo.fileName.trim() || photo.fileName.length > 255 || typeof photo.mimeType !== 'string' || !Number.isSafeInteger(photo.fileSize) || Number(photo.fileSize) < 1 || Number(photo.fileSize) > 20 * 1024 * 1024 || typeof photo.payloadBase64 !== 'string' || photo.payloadBase64.length > 28 * 1024 * 1024)
      return rosterProblem('validation-failed', '照片名称、大小或正文无效')
  }
  return { ...value, values } as WorkerRosterCommand
}
export function rosterCanonical(value: unknown): string {
  const stable = (input: unknown): unknown => Array.isArray(input) ? input.map(stable) : rosterObject(input) ? Object.fromEntries(Object.keys(input).sort().map(key => [key, stable(input[key])])) : input
  return JSON.stringify(stable(value))
}
