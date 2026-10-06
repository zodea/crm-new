import type { ProblemDTO, ReadMetaDTO } from '../../types/read-model'
import type { FileRefChanges, FileRefRecord } from '../forms/file-refs'
import type { QuotationRelations } from './import-evidence'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'

export interface QuotationLine {
  id: string
  name: string
  spec: string
  grade: string
  brand: string
  unit: string
  unitPrice: number | null
  quantity: number | null
  taxIncluded: boolean | null
  taxRate: number | null
  freight: string | null
  quantityCondition: string | null
  paymentCondition: string | null
  validity: string | null
}
export interface QuotationDraft {
  partyName: string
  supplierId: string | null
  scope: 'general' | 'project' | 'unknown'
  projectId: string | null
  quotationDate: string | null
  note: string
  lines: QuotationLine[]
}
export interface QuotationFile extends FileRefRecord {
  sha256: string
}
export interface QuotationHistory {
  version: string
  draft: QuotationDraft
  files: QuotationFile[]
  actorId: string
  commandId: string
  occurredAt: string
}
export interface QuotationRecord {
  id: string
  draft: QuotationDraft
  attachments: QuotationFile[]
  history: QuotationHistory[]
  version: string
  createdAt: string
  updatedAt: string
  relations?: QuotationRelations[]
}
export interface QuotationRead {
  records: QuotationRecord[]
  meta: ReadMetaDTO
  asOf: string
  sourceVersion: string | null
  capabilities: string[]
}
export interface QuotationContext {
  workspaceId: string
  actorId: string
  capabilities: string[]
  projects: {
    id: string
    name: string
  }[]
  suppliers: {
    id: string
    name: string
  }[]
}
export interface QuotationCommand {
  workspaceId: string
  actorId: string
  requiredCapability: 'material-quotation:write'
  commandId: string
  id?: string
  baseVersion: string | null
  action: 'save'
  draft: QuotationDraft
  attachments: FileRefChanges
}
export interface QuotationResult {
  id: string
  version: string
  commandId: string
  updatedAt: string
  attachmentIds: string[]
}
export type QuotationResolution = {
  outcome: 'applied'
  result: QuotationResult
} | {
  outcome: 'not-applied'
  commandId: string
}
export class QuotationProblem extends Error {
  constructor(public readonly problem: ProblemDTO) {
    super(problem.message)
    this.name = 'QuotationProblem'
  }
}
export function quotationProblem(code: ProblemDTO['code'], message: string): never {
  throw new QuotationProblem({ code, message, retryable: code === 'unavailable', fieldErrors: {}, traceId: null })
}
export const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).sort().join(',') === [...expected].sort().join(',')
const optionalText = (value: unknown) => value === null || typeof value === 'string'
const numberOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
export function decodeQuotationDraft(value: unknown): QuotationDraft {
  if (!isObject(value) || !keys(value, ['partyName', 'supplierId', 'scope', 'projectId', 'quotationDate', 'note', 'lines'])
    || typeof value.partyName !== 'string' || !value.partyName.trim() || typeof value.note !== 'string'
    || !['general', 'project', 'unknown'].includes(String(value.scope))
    || !(value.supplierId === null || validId(value.supplierId)) || !(value.projectId === null || validId(value.projectId))
    || (value.scope === 'project' ? value.projectId === null : value.projectId !== null)
    || !(value.quotationDate === null || isISODateDTO(value.quotationDate)) || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > 1000) {
    return quotationProblem('validation-failed', '报价方、适用范围、日期或材料明细不完整')
  }
  const lines = value.lines.map((line): QuotationLine => {
    if (!isObject(line) || !keys(line, ['id', 'name', 'spec', 'grade', 'brand', 'unit', 'unitPrice', 'quantity', 'taxIncluded', 'taxRate', 'freight', 'quantityCondition', 'paymentCondition', 'validity'])
      || !validId(line.id) || ['name', 'spec', 'grade', 'brand', 'unit'].some(key => typeof line[key] !== 'string') || !String(line.name).trim() || !String(line.unit).trim()
      || !numberOrNull(line.unitPrice) || !numberOrNull(line.quantity) || !numberOrNull(line.taxRate) || Number(line.taxRate ?? 0) > 100
      || !(line.taxIncluded === null || typeof line.taxIncluded === 'boolean')
      || ['freight', 'quantityCondition', 'paymentCondition', 'validity'].some(key => !optionalText(line[key]))) {
      return quotationProblem('validation-failed', '报价明细的稳定身份、单位、原价或条件无效；未知数值请保留为空')
    }
    return { ...line } as unknown as QuotationLine
  })
  if (new Set(lines.map(line => line.id)).size !== lines.length)
    return quotationProblem('validation-failed', '报价明细身份重复')
  return { partyName: value.partyName, supplierId: value.supplierId, scope: value.scope as QuotationDraft['scope'], projectId: value.projectId, quotationDate: value.quotationDate as string | null, note: value.note, lines }
}
export function decodeQuotationCommand(value: unknown): QuotationCommand {
  if (!isObject(value) || !keys(value, ['workspaceId', 'actorId', 'requiredCapability', 'commandId', ...(value.id === undefined ? [] : ['id']), 'baseVersion', 'action', 'draft', 'attachments'])
    || !validId(value.workspaceId) || !validId(value.actorId) || !validId(value.commandId) || (value.id !== undefined && !validId(value.id))
    || value.requiredCapability !== 'material-quotation:write' || value.action !== 'save'
    || (value.id ? !(typeof value.baseVersion === 'string' && /^[1-9]\d*$/.test(value.baseVersion)) : value.baseVersion !== null)
    || !isObject(value.attachments) || Object.keys(value.attachments).some(key => !['add', 'removeIds', 'restoreIds'].includes(key))) {
    return quotationProblem('validation-failed', '报价命令身份、版本或附件结构无效')
  }
  for (const field of ['removeIds', 'restoreIds']) {
    if (value.attachments[field] !== undefined && (!Array.isArray(value.attachments[field]) || (value.attachments[field] as unknown[]).some(id => !validId(id)) || new Set(value.attachments[field] as unknown[]).size !== (value.attachments[field] as unknown[]).length))
      return quotationProblem('validation-failed', '报价原件操作身份无效')
  }
  if (value.attachments.add !== undefined && (!Array.isArray(value.attachments.add) || value.attachments.add.length > 20))
    return quotationProblem('validation-failed', '一次最多添加20份报价原件')
  return { ...value, draft: decodeQuotationDraft(value.draft) } as unknown as QuotationCommand
}
export function decodeQuotationResult(value: unknown): QuotationResult {
  if (!isObject(value) || !keys(value, ['id', 'version', 'commandId', 'updatedAt', 'attachmentIds']) || !validId(value.id) || !validId(value.commandId)
    || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version) || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || value.attachmentIds.some(id => !validId(id)) || new Set(value.attachmentIds).size !== value.attachmentIds.length) {
    return quotationProblem('internal-error', '报价回执缺少真实身份或版本')
  }
  return value as unknown as QuotationResult
}
/** Sorted complete request, including original bytes. No draft-only or label-based replay key. */
export function quotationFingerprint(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(quotationFingerprint).join(',')}]`
  if (isObject(value))
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${quotationFingerprint(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function quotationCommandKey(commandId: string, actor: {
  workspaceId: string
  actorId: string
}) {
  return JSON.stringify([actor.workspaceId, actor.actorId, 'material-quotation', commandId])
}
export const newQuotationLine = (): QuotationLine => ({ id: `quotation-line-${crypto.randomUUID()}`, name: '', spec: '', grade: '', brand: '', unit: '', unitPrice: null, quantity: null, taxIncluded: null, taxRate: null, freight: null, quantityCondition: null, paymentCondition: null, validity: null })
export const newQuotationDraft = (): QuotationDraft => ({ partyName: '', supplierId: null, scope: 'unknown', projectId: null, quotationDate: null, note: '', lines: [newQuotationLine()] })
