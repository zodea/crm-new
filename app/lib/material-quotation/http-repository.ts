import type { QuotationCommand, QuotationContext, QuotationFile, QuotationRead, QuotationRecord } from './contract'
import { isTauri } from '@tauri-apps/api/core'
import { isISODateTimeDTO } from '../../types/read-model'
import { decodeContractOriginalContent } from '../forms/original-content'
import { hasConsistentReadMeta, isReadMetaDTO } from '../read-model/meta'
import { problemFromHttpFailure } from '../read-model/problem'
import { decodeQuotationDraft, decodeQuotationResult, isObject, quotationFingerprint, QuotationProblem, quotationProblem, validId } from './contract'

function decodeFile(value: unknown, ownerId: string): QuotationFile {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'category,deletedAt,fileName,filePath,fileSize,id,mimeType,ownerId,ownerType,sha256,uploadedAt,uploader' || !validId(value.id) || value.ownerId !== ownerId || value.ownerType !== 'material_quotation' || ['fileName', 'filePath', 'mimeType', 'category', 'uploader'].some(key => typeof value[key] !== 'string') || !String(value.fileName).trim() || !Number.isSafeInteger(value.fileSize) || Number(value.fileSize) < 0 || !isISODateTimeDTO(value.uploadedAt) || !(value.deletedAt === null || isISODateTimeDTO(value.deletedAt)) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
    return quotationProblem('internal-error', '报价原件读取身份或摘要无效')
  return value as unknown as QuotationFile
}
export function decodeQuotationRecord(value: unknown): QuotationRecord {
  if (!isObject(value) || !['attachments,createdAt,draft,history,id,updatedAt,version', 'attachments,createdAt,draft,history,id,relations,updatedAt,version'].includes(Object.keys(value).sort().join(',')) || !validId(value.id) || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version) || !isISODateTimeDTO(value.createdAt) || !isISODateTimeDTO(value.updatedAt) || !Array.isArray(value.history) || !Array.isArray(value.attachments))
    return quotationProblem('internal-error', '报价读取身份或版本无效')
  const id = value.id
  const draft = decodeQuotationDraft(value.draft)
  const attachments = value.attachments.map(file => decodeFile(file, id))
  const history = value.history.map((row, index) => {
    if (!isObject(row) || Object.keys(row).sort().join(',') !== 'actorId,commandId,draft,files,occurredAt,version' || row.version !== String(index + 1) || !validId(row.actorId) || !validId(row.commandId) || !isISODateTimeDTO(row.occurredAt) || !Array.isArray(row.files))
      return quotationProblem('internal-error', '报价冻结历史缺少连续版本或命令依据')
    const files = row.files.map(file => decodeFile(file, id))
    if (files.some(file => !attachments.some(actual => actual.id === file.id && actual.sha256 === file.sha256)))
      return quotationProblem('internal-error', '报价历史原件缺失')
    return { version: String(row.version), actorId: row.actorId, commandId: row.commandId, occurredAt: row.occurredAt, draft: decodeQuotationDraft(row.draft), files }
  })
  if (history.length !== Number(value.version) || history[0]?.occurredAt !== value.createdAt || history.at(-1)?.occurredAt !== value.updatedAt || quotationFingerprint(history.at(-1)?.draft) !== quotationFingerprint(draft) || quotationFingerprint(history.at(-1)?.files) !== quotationFingerprint(attachments) || new Set(attachments.map(file => file.id)).size !== attachments.length)
    return quotationProblem('internal-error', '报价当前资料与历史不一致')
  let relations: QuotationRecord['relations']
  if (value.relations !== undefined) {
    if (!Array.isArray(value.relations))
      return quotationProblem('internal-error', '报价迁入关系投影无效')
    relations = value.relations.map((row) => {
      if (!isObject(row) || Object.keys(row).sort().join(',') !== 'importBatchId,projectId,sourceSnapshotSha256,supplierId,version' || !history.some(history => history.version === row.version) || !(row.projectId === null || validId(row.projectId)) || !(row.supplierId === null || validId(row.supplierId)) || !validId(row.importBatchId) || typeof row.sourceSnapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceSnapshotSha256))
        return quotationProblem('internal-error', '报价迁入关系缺少原版本、目标身份或来源证据')
      const source = history.find(history => history.version === row.version)!.draft
      if ((row.projectId === null) !== (source.projectId === null) || (row.supplierId === null) !== (source.supplierId === null))
        return quotationProblem('internal-error', '报价迁入不能凭投影增删原关联事实')
      return row as unknown as NonNullable<QuotationRecord['relations']>[number]
    })
    if (new Set(relations.map(row => row.version)).size !== relations.length)
      return quotationProblem('internal-error', '报价迁入同版本存在冲突关系')
  }
  return { id, draft, attachments, history, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(relations ? { relations } : {}) }
}
export function decodeQuotationRead(value: unknown): QuotationRead {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'asOf,capabilities,meta,records,sourceVersion' || !hasConsistentReadMeta(value, 'material-quotation-read-v1', 'real') || !isReadMetaDTO(value.meta, 'material-quotation-read-v1') || !Array.isArray(value.records))
    return quotationProblem('internal-error', '报价来源缺少本次真实读取证明')
  const records = value.records.map(decodeQuotationRecord)
  if (new Set(records.map(record => record.id)).size !== records.length)
    return quotationProblem('internal-error', '报价稳定身份重复')
  return { records, meta: value.meta, asOf: value.meta.asOf, sourceVersion: value.meta.sourceVersion, capabilities: [...value.meta.capabilities] }
}
export function decodeQuotationContext(value: unknown): QuotationContext {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'actorId,asOf,capabilities,meta,projects,sourceVersion,suppliers,workspaceId'
    || !hasConsistentReadMeta(value, 'material-quotation-context-v1', 'real') || !isReadMetaDTO(value.meta, 'material-quotation-context-v1') || value.workspaceId !== value.meta.workspaceId || value.actorId !== value.meta.actorId
    || !validId(value.workspaceId) || !validId(value.actorId) || !Array.isArray(value.capabilities) || value.capabilities.some(capability => typeof capability !== 'string') || !Array.isArray(value.projects) || !Array.isArray(value.suppliers)) {
    return quotationProblem('internal-error', '报价会话或关联目录无效')
  }
  const directory = (rows: unknown[]) => rows.map((row) => {
    if (!isObject(row) || Object.keys(row).sort().join(',') !== 'id,name' || !validId(row.id) || typeof row.name !== 'string')
      return quotationProblem('internal-error', '报价关联候选缺少稳定身份')
    return { id: row.id, name: row.name }
  })
  const projects = directory(value.projects)
  const suppliers = directory(value.suppliers)
  if (new Set(projects.map(row => row.id)).size !== projects.length || new Set(suppliers.map(row => row.id)).size !== suppliers.length)
    return quotationProblem('internal-error', '报价关联目录身份重复')
  return { workspaceId: value.workspaceId, actorId: value.actorId, capabilities: value.capabilities as string[], projects, suppliers }
}
export function quotationUnknownProblem(cause: unknown) {
  if (cause instanceof QuotationProblem)
    return cause
  const problem = problemFromHttpFailure(cause)
  return new QuotationProblem(problem ?? { code: 'unavailable', message: cause instanceof Error ? cause.message : '报价暂不可用，请保留输入', retryable: true, fieldErrors: {}, traceId: null })
}
export function createQuotationHttpRepository(fetcher: (url: string, options?: object) => Promise<unknown>) {
  async function read<T>(load: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
    try {
      if (isTauri())
        return quotationProblem('unavailable', 'Native 尚无可信中央报价身份；保留本地原图，在正式浏览器工作区读取、写入或迁入')
      return decode(await load())
    }
    catch (cause) {
      throw quotationUnknownProblem(cause)
    }
  }
  const list = () => read(() => fetcher('/api/read/material-quotations'), decodeQuotationRead)
  return {
    list,
    context: () => read(() => fetcher('/api/read/material-quotations/context'), decodeQuotationContext),
    loadForm: async (id: string) => {
      const record = (await list()).records.find(record => record.id === id)
      if (!record)
        return quotationProblem('not-found', '报价不存在或没有读取其关联来源的权限')
      const relation = record.relations?.find(row => row.version === record.version)
      return { draft: { ...record.draft, ...(relation ? { projectId: relation.projectId, supplierId: relation.supplierId } : {}), id }, version: record.version, updatedAt: record.updatedAt, attachments: record.attachments, history: record.history }
    },
    execute: (request: QuotationCommand & {
      draft: QuotationCommand['draft'] & {
        id?: string
      }
    }) => {
      const { id: _id, ...draft } = request.draft
      return read(() => fetcher('/api/commands/material-quotations', { method: 'POST', body: { ...request, draft } }), decodeQuotationResult)
    },
    resolve: (commandId: string) => read(() => fetcher('/api/commands/material-quotations/resolve', { method: 'POST', body: { commandId } }), (value) => {
      if (!isObject(value) || Object.keys(value).length !== 2)
        return quotationProblem('internal-error', '原编号核对结果无效')
      if (value.outcome === 'not-applied' && value.commandId === commandId)
        return { outcome: 'not-applied' as const, commandId }
      if (value.outcome === 'applied') {
        const result = decodeQuotationResult(value.result)
        if (result.commandId === commandId)
          return { outcome: 'applied' as const, result }
      }
      return quotationProblem('internal-error', '原编号核对结果与当前请求不一致')
    }),
    original: (id: string, fileId: string, version?: string, signal?: AbortSignal) => read(() => fetcher(`/api/read/material-quotations/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { query: version ? { version } : {}, signal }), value => decodeContractOriginalContent(value, { ownerId: id, fileId, origin: 'real' }, () => quotationProblem('internal-error', '报价原件正文或身份不一致'))),
  }
}
