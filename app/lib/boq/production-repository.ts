import type { CommandRecoveryDescriptor, CommandResolution } from '../forms/command-recovery'
import type { BoqCommand, BoqCommandResult, BoqIdentity, BoqScope, ProductionBoqRead } from './production-contract'
import { quantityProblem } from '../quantity/central-contract'
import { problemFromHttpFailure } from '../read-model/problem'
import { boqRecoveryDescriptor } from './command-recovery'

export type BoqFetcher = (url: string, options?: { method?: 'POST', body?: object, query?: Record<string, unknown> }) => Promise<unknown>
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function result(value: unknown, identity: Pick<BoqCommand, 'workspaceId' | 'actorId' | 'commandId' | 'projectId' | 'contractId'>, descriptor: CommandRecoveryDescriptor): BoqCommandResult {
  if (!object(value) || !['workspaceId', 'actorId', 'commandId', 'projectId', 'contractId'].every(key => value[key] === identity[key as keyof typeof identity]) || typeof value.id !== 'string' || typeof value.action !== 'string' || typeof value.sourceVersion !== 'string')
    throw quantityProblem('unavailable', '原清单回执与固定编号、主合同或项目不同')
  if (value.action !== descriptor.action || (['patch-line', 'delete-line', 'correct-building', 'reject-change'].includes(descriptor.action) && value.id !== descriptor.targetId) || (descriptor.action === 'owner-change' && ((!descriptor.targetId?.startsWith('change:') && value.id !== descriptor.targetId) || value.changeId !== value.id)) || (descriptor.action === 'import-file' && (value.fileId !== value.id || !Array.isArray(value.lineIds) || !Array.isArray(value.priceIds))) || (descriptor.action === 'correct-building' && (!object(value.buildingResult) || value.buildingResult.lineId !== value.id || value.buildingResult.commandId !== value.commandId)))
    throw quantityProblem('unavailable', '原清单回执的动作或实际目标与原提交不同')
  return structuredClone(value) as unknown as BoqCommandResult
}
export function createProductionBoqRepository(fetcher: BoqFetcher) {
  async function request<T>(url: string, options: Parameters<BoqFetcher>[1], decode: (value: unknown) => T) {
    try {
      return decode(await fetcher(url, options))
    }
    catch (cause) {
      const problem = problemFromHttpFailure(cause)
      if (problem)
        throw Object.assign(new Error(problem.message), { problem })
      throw cause
    }
  }
  return {
    file: (scope: BoqScope & { ownerKind: 'boq-file' | 'owner-change', ownerId: string, fileId: string }, identity: BoqIdentity) => request('/api/read/boq/files', { query: { ...scope } }, async (value) => {
      if (!object(value) || !['projectId', 'contractId', 'origin', 'ownerKind', 'ownerId', 'fileId'].every(key => value[key] === scope[key as keyof typeof scope]) || value.workspaceId !== identity.workspaceId || value.actorId !== identity.actorId || typeof value.fileName !== 'string' || typeof value.mimeType !== 'string' || typeof value.payloadBase64 !== 'string' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.fileSize))
        throw quantityProblem('unavailable', '原件响应的真实身份、项目主合同或附件不同')
      const binary = atob(value.payloadBase64)
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (bytes.length !== value.fileSize || btoa(binary) !== value.payloadBase64 || sha256 !== value.sha256)
        throw quantityProblem('unavailable', '原完整文件大小或摘要不同，不能下载替代字节')
      return { data: bytes, defaultName: value.fileName, mimeType: value.mimeType }
    }),
    catalog: () => request('/api/read/boq/catalog', undefined, (value) => {
      if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || !Array.isArray(value.capabilities) || !Array.isArray(value.contracts))
        throw quantityProblem('unavailable', '施工主合同候选来源尚未完整核对')
      if (!value.contracts.every(row => object(row) && Number.isSafeInteger(row.lineCount) && Number(row.lineCount) >= 0))
        throw quantityProblem('unavailable', '当前主合同清单数量没有实际读取证据')
      return value as unknown as BoqIdentity & { contracts: Array<{ id: string, projectId: string, projectName: string, no: string, name: string, status: string, lineCount: number }>, sourceVersion: string }
    }),
    read: (scope: BoqScope) => request('/api/read/boq/workspace', { query: { ...scope } }, (value) => {
      if (!object(value) || value.projectId !== scope.projectId || value.contractId !== scope.contractId || value.origin !== 'real' || typeof value.sourceVersion !== 'string' || typeof value.contractVersion !== 'string' || !Array.isArray(value.files) || !Array.isArray(value.lines) || !Array.isArray(value.prices) || !Array.isArray(value.changes))
        throw quantityProblem('unavailable', '清单读回不是同一真实项目与施工主合同')
      return value as unknown as ProductionBoqRead
    }),
    items: (scope: BoqScope) => request('/api/read/boq/items', { query: { ...scope } }, (value) => {
      if (!Array.isArray(value) || !value.every(row => object(row) && typeof row.id === 'string' && typeof row.version === 'string'))
        throw quantityProblem('unavailable', '原分项身份尚未成功读取')
      return value as Array<{ id: string, code: string, name: string, trade: string, unit: string, version: string }>
    }),
    execute: (command: BoqCommand) => request('/api/commands/boq', { method: 'POST', body: structuredClone(command) }, value => result(value, command, boqRecoveryDescriptor(command))),
    resolve: (descriptor: CommandRecoveryDescriptor) => request('/api/commands/boq/resolve', { method: 'POST', body: { ...descriptor } }, (value): CommandResolution<BoqCommandResult> => {
      if (!object(value))
        throw quantityProblem('unavailable', '原清单恢复回执无法核对')
      if (value.outcome === 'not-applied' && value.commandId === descriptor.commandId)
        return value as unknown as CommandResolution<BoqCommandResult>
      if (value.outcome !== 'applied' || !object(value.result) || value.result.workspaceId !== descriptor.workspaceId || value.result.actorId !== descriptor.actorId || value.result.commandId !== descriptor.commandId || `${value.result.projectId}:${value.result.contractId}` !== descriptor.scopeId)
        throw quantityProblem('unavailable', '原清单恢复范围与动作不同')
      return { outcome: 'applied', result: result(value.result, { workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, commandId: descriptor.commandId, projectId: String(value.result.projectId), contractId: String(value.result.contractId) }, descriptor) }
    }),
  }
}
