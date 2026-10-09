import type { MoneyDTO, ProblemDTO, ReadMetaDTO } from '../../types/read-model'
import type { ConstructionScopeResult } from '../construction-scope/contract'
import type { CommandResolution } from '../forms/command-recovery'
import type { FileRefChanges, FileRefRecord } from '../forms/file-refs'
import type { LookupOption } from '../kit/lookup'
import type { F3FormDraft, F3FormKind, F3SaveAction, FinanceFormRecordMap } from './forms'
import type { PaymentApplicationDetailRead } from './payment-detail-contract'
import { problemFromHttpFailure } from '../read-model/problem'
import { PAYMENT_BIZ_TYPES } from './domain'

export type CentralFinanceKind = Exclude<F3FormKind, 'receipt'>
export type FinanceCommandAction = F3SaveAction | 'unconfirm' | 'delete'
export const CENTRAL_FINANCE_KINDS: readonly CentralFinanceKind[] = ['current', 'reimbursement', 'payment_application', 'payment_record', 'invoice_application']
export const FINANCE_FAMILIES: Record<CentralFinanceKind, string> = {
  current: 'finance-current',
  reimbursement: 'finance-reimbursement',
  payment_application: 'finance-payment-application',
  payment_record: 'finance-payment-record',
  invoice_application: 'finance-invoice-application',
}
export const FINANCE_CAPABILITIES = Object.freeze(Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`]))
export const FINANCE_IMPORT_CAPABILITY = 'core:migration:write' as const
export type FinanceProblemCode = 'unauthenticated' | 'forbidden' | 'validation-failed' | 'invalid-query' | 'conflict' | 'not-found' | 'unavailable'
export type FinanceProblem = ProblemDTO
export class FinanceRepositoryProblem extends Error {
  readonly problem: ProblemDTO
  constructor(problem: Pick<ProblemDTO, 'code' | 'message'> & Partial<ProblemDTO>) {
    super(problem.message)
    this.problem = { retryable: problem.code === 'unavailable', fieldErrors: {}, traceId: null, ...problem }
    this.name = 'FinanceRepositoryProblem'
  }
}
export function financeFailure(code: FinanceProblemCode, message: string): never {
  throw new FinanceRepositoryProblem({ code, message })
}
export function financeProblemFromUnknown(cause: unknown): FinanceRepositoryProblem {
  if (cause instanceof FinanceRepositoryProblem)
    return cause
  const problem = problemFromHttpFailure(cause)
  if (problem)
    return new FinanceRepositoryProblem(problem)
  return new FinanceRepositoryProblem({ code: 'unavailable', message: '财务来源暂时无法可靠读取，请保留输入并核对原提交。' })
}
export interface FinanceContext {
  workspaceId: string
  actorId: string
  capabilities: string[]
  sourceVersion: string | null
  meta: ReadMetaDTO
  asOf: string
  dataOrigin: 'real'
  scope: FinanceReadScope
}
export const FINANCE_READ_SCHEMA = 'finance-read-v1'
export interface FinanceReadScope { kind: CentralFinanceKind, operation: 'context' | 'form' | 'list' | 'lookup' | 'customer' | 'migration' | 'preflight' | 'detail', id?: string, query?: FinanceLookupQuery }
export interface FinanceReadEnvelope<T> extends FinanceContext { items: T[] }
export interface FinanceCommand {
  workspaceId: string
  actorId: string
  requiredCapability: string
  commandId: string
  kind: CentralFinanceKind
  id?: string
  baseVersion: string | null
  action: FinanceCommandAction
  draft: F3FormDraft
  attachments: FileRefChanges
}
export interface FinanceCommandResult { id: string, commandId: string, version: string, updatedAt: string, attachmentIds: string[], logId: string | null, paymentVerificationSha256?: string, clearanceVerificationSha256?: string, clearanceVerificationId?: string, constructionScopeLinks?: ConstructionScopeResult[], expenseLineIdentities?: Array<{ inputIndex: number, id: string }> }
export interface FinanceFormData<K extends CentralFinanceKind = CentralFinanceKind> {
  draft: FinanceFormRecordMap[K]
  attachments: Array<FileRefRecord & { sha256: string | null }>
  version: string
  updatedAt: string
}
export interface FinanceFormRead<K extends CentralFinanceKind = CentralFinanceKind> extends FinanceFormData<K>, FinanceContext {}
export type FinanceLookupKind = 'projects' | 'customers' | 'suppliers' | 'workers' | 'contracts' | 'settlements' | 'invoices' | 'original-expenses' | 'payment-applications' | 'construction-mains'
export interface FinanceLookupQuery { kind: FinanceLookupKind, keyword: string, projectId?: string | null, supplierId?: string | null, workerId?: string | null, contractId?: string | null, excludeId?: string, contractKinds?: string[], paymentBizType?: string }
export function normalizeFinanceLookup(value: unknown): FinanceLookupQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    financeFailure('validation-failed', '财务候选查询无效。')
  const query = value as Record<string, unknown>
  if (Object.keys(query).some(key => !['kind', 'keyword', 'projectId', 'supplierId', 'workerId', 'contractId', 'excludeId', 'contractKinds', 'paymentBizType'].includes(key))
    || !['projects', 'customers', 'suppliers', 'workers', 'contracts', 'settlements', 'invoices', 'original-expenses', 'payment-applications', 'construction-mains'].includes(String(query.kind))
    || (query.keyword !== undefined && (typeof query.keyword !== 'string' || query.keyword.length > 200))) {
    financeFailure('validation-failed', '财务候选查询包含不支持的范围。')
  }
  const result: FinanceLookupQuery = { kind: query.kind as FinanceLookupKind, keyword: typeof query.keyword === 'string' ? query.keyword : '' }
  for (const key of ['projectId', 'supplierId', 'contractId'] as const) {
    const id = query[key]
    if (id !== undefined && id !== null && id !== '' && (typeof id !== 'string' || !/^[a-z0-9][\w-]{2,99}$/i.test(id)))
      financeFailure('validation-failed', '财务候选关联编号无效。')
    result[key] = id === undefined || id === null || id === '' ? null : id as string
  }
  if (query.workerId !== undefined) {
    if (query.workerId !== null && query.workerId !== '' && (typeof query.workerId !== 'string' || !/^[a-z0-9][\w-]{2,99}$/i.test(query.workerId)))
      financeFailure('validation-failed', '财务候选工人稳定编号无效。')
    result.workerId = query.workerId === null || query.workerId === '' ? null : query.workerId as string
  }
  if (result.workerId && result.supplierId)
    financeFailure('validation-failed', '财务候选付款对象不能同时为工人与分供方。')
  if (query.excludeId !== undefined) {
    if (typeof query.excludeId !== 'string' || !/^[a-z0-9][\w-]{2,99}$/i.test(query.excludeId))
      financeFailure('validation-failed', '财务候选排除编号无效。')
    result.excludeId = query.excludeId
  }
  if (query.contractKinds !== undefined) {
    const kinds = Array.isArray(query.contractKinds) ? query.contractKinds : [query.contractKinds]
    if (!kinds.every(kind => typeof kind === 'string' && ['施工', '分包', '材采', '其他支出'].includes(kind)) || new Set(kinds).size !== kinds.length)
      financeFailure('validation-failed', '财务合同类型范围无效。')
    result.contractKinds = [...kinds].sort() as string[]
  }
  if (query.paymentBizType !== undefined) {
    if (query.kind !== 'contracts' || typeof query.paymentBizType !== 'string' || !PAYMENT_BIZ_TYPES.includes(query.paymentBizType as typeof PAYMENT_BIZ_TYPES[number]))
      financeFailure('validation-failed', '付款合同候选的业务类型无效。')
    result.paymentBizType = query.paymentBizType
  }
  return result
}
export interface CentralFinanceListRow { id: string, no: string, name: string, projectName: string, partyName: string, amount: MoneyDTO, date: string, status: string, customerId: string | null, dataOrigin: 'real' }
export interface FinanceRepository {
  paymentDetail: (id: string) => Promise<PaymentApplicationDetailRead>
  context: (kind: CentralFinanceKind) => Promise<FinanceContext>
  form: <K extends CentralFinanceKind>(kind: K, id: string) => Promise<FinanceFormRead<K>>
  list: (kind: CentralFinanceKind) => Promise<FinanceReadEnvelope<CentralFinanceListRow>>
  lookup: (kind: CentralFinanceKind, query: FinanceLookupQuery) => Promise<FinanceReadEnvelope<LookupOption>>
  customer: (kind: CentralFinanceKind, id: string) => Promise<FinanceReadEnvelope<{ name: string, taxNo: string }>>
  execute: (request: FinanceCommand) => Promise<FinanceCommandResult>
  resolve: (kind: CentralFinanceKind, commandId: string) => Promise<CommandResolution<FinanceCommandResult>>
  original: (kind: CentralFinanceKind, id: string, fileId: string) => Promise<{ bytes: Uint8Array, mimeType: string }>
}
