import type { OurSignatoryCommandRequest, OurSignatoryCommandResult, OurSignatoryDraft, OurSignatoryListDTO, OurSignatoryRecord } from './contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { hasConsistentReadMeta, isReadMetaDTO } from '../read-model/meta'
import { problemFromHttpFailure } from '../read-model/problem'
import { decodeOurSignatoryDraft, OurSignatoryRepositoryProblem, signatoryProblem } from './contract'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export function decodeOurSignatoryRecord(value: unknown): OurSignatoryRecord {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'createdAt,draft,history,id,updatedAt,version' || typeof value.id !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(value.id)
    || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version) || !isISODateTimeDTO(value.createdAt) || !isISODateTimeDTO(value.updatedAt)) {
    return signatoryProblem('internal-error', '我方主体读取结果身份或版本无效')
  }
  if (!Array.isArray(value.history) || value.history.length !== Number(value.version))
    return signatoryProblem('internal-error', '主体核实历史不完整')
  const history = value.history.map((row) => {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'actorId,commandId,draft,id,occurredAt,version' || typeof row.version !== 'string' || !/^[1-9]\d*$/.test(row.version) || row.id !== `${value.id}-v${row.version}`
      || !(row.actorId === null || typeof row.actorId === 'string') || !(row.commandId === null || typeof row.commandId === 'string') || !isISODateTimeDTO(row.occurredAt)) {
      return signatoryProblem('internal-error', '主体核实历史身份或发生依据无效')
    }
    return { id: String(row.id), version: row.version, draft: decodeOurSignatoryDraft(row.draft), actorId: row.actorId, commandId: row.commandId, occurredAt: row.occurredAt }
  })
  if (new Set(history.map(row => row.version)).size !== history.length || history.some(row => Number(row.version) > Number(value.version)) || !history.some(row => row.version === value.version))
    return signatoryProblem('internal-error', '主体核实历史版本不连续')
  const draft = decodeOurSignatoryDraft(value.draft)
  const current = history.find(row => row.version === value.version)!
  if (current.occurredAt !== value.updatedAt || history.find(row => row.version === '1')?.occurredAt !== value.createdAt
    || ['name', 'taxNo', 'registeredAddress', 'legalRepresentative', 'verificationNote', 'status'].some(key => current.draft[key as keyof OurSignatoryDraft] !== draft[key as keyof OurSignatoryDraft])) {
    return signatoryProblem('internal-error', '主体当前资料与历史依据不一致')
  }
  return { id: value.id, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt, draft, history }
}
export function decodeOurSignatoryList(value: unknown): OurSignatoryListDTO {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'asOf,capabilities,meta,records,sourceVersion' || !hasConsistentReadMeta(value, 'our-signatory-read-v2', 'real') || !isReadMetaDTO(value.meta, 'our-signatory-read-v2') || !Array.isArray(value.records))
    return signatoryProblem('internal-error', '我方主体目录缺少本次真实读取依据')
  const records = value.records.map(decodeOurSignatoryRecord)
  if (new Set(records.map(record => record.id)).size !== records.length)
    return signatoryProblem('internal-error', '我方主体目录存在重复身份')
  return { records, meta: value.meta, asOf: value.meta.asOf, sourceVersion: value.meta.sourceVersion, capabilities: [...value.meta.capabilities] }
}
function commandResult(value: unknown): OurSignatoryCommandResult & {
  attachmentIds: string[]
} {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'commandId,id,updatedAt,version' || typeof value.id !== 'string' || !value.id || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version) || !isISODateTimeDTO(value.updatedAt)) {
    return signatoryProblem('internal-error', '我方主体原回执无效')
  }
  return { id: value.id, commandId: value.commandId, version: value.version, updatedAt: value.updatedAt, attachmentIds: [] }
}
export function createOurSignatoryRepository(fetcher: (url: string, options?: object) => Promise<unknown>) {
  async function read<T>(load: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
    try {
      return decode(await load())
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw cause
      const problem = problemFromHttpFailure(cause)
      if (problem)
        throw new OurSignatoryRepositoryProblem(problem)
      return signatoryProblem('unavailable', '我方主体目录暂不可用，请保留输入并重试')
    }
  }
  const list = () => read(() => fetcher('/api/read/our-signatories'), decodeOurSignatoryList)
  return {
    list,
    context: async () => {
      const result = await list()
      return { workspaceId: result.meta.workspaceId, actorId: result.meta.actorId, capabilities: result.capabilities }
    },
    loadForm: async (id: string) => {
      const record = (await list()).records.find(row => row.id === id)
      if (!record)
        return signatoryProblem('not-found', '我方主体不存在')
      return { draft: { ...record.draft, id }, version: record.version, updatedAt: record.updatedAt, attachments: [], history: record.history }
    },
    execute: (request: OurSignatoryCommandRequest & {
      action: string
      attachments: object
      draft: OurSignatoryDraft & {
        id?: string
      }
    }) => {
      const { id: _draftId, ...draft } = request.draft
      const body: OurSignatoryCommandRequest = { workspaceId: request.workspaceId, actorId: request.actorId, requiredCapability: request.requiredCapability, commandId: request.commandId, ...(request.id ? { id: request.id } : {}), baseVersion: request.baseVersion, draft }
      return read(() => fetcher('/api/commands/our-signatories', { method: 'POST', body }), commandResult)
    },
    resolve: (commandId: string) => read(() => fetcher('/api/commands/our-signatories/resolve', { method: 'POST', body: { commandId } }), (value) => {
      if (!object(value))
        return signatoryProblem('internal-error', '原编号核对结果无效')
      if (value.outcome === 'not-applied' && value.commandId === commandId && Object.keys(value).length === 2)
        return { outcome: 'not-applied' as const, commandId }
      if (value.outcome === 'applied' && Object.keys(value).length === 2) {
        const result = commandResult(value.result)
        if (result.commandId === commandId)
          return { outcome: 'applied' as const, result }
      }
      return signatoryProblem('internal-error', '原编号或回执与当前提交不一致')
    }),
  }
}
