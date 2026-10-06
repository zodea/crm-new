import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  ProjectSupplierWorkbenchQueryDTO,
  ProjectSupplierWorkbenchReadDTO,
} from './read-contract'
import {
  isDataOriginDTO,
  isEntityKindDTO,
  isISODateDTO,
  isISODateTimeDTO,
} from '../../types/read-model'
import { isApprovalReadState } from '../finance/approval-amount'
import { hasConsistentReadMeta } from '../read-model/meta'
import { problemFromHttpFailure } from '../read-model/problem'
import {
  projectSupplierProblem,
  ProjectSupplierRepositoryProblem,
} from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function stringFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && fields.every(field => typeof value[field] === 'string')
}

function moneyFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && fields.every(field => money(value[field]))
}

function countFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && fields.every(field => Number.isSafeInteger(value[field]) && Number(value[field]) >= 0)
}

function money(value: unknown): value is string {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
}

function nullableDate(value: unknown): boolean {
  return value === null || isISODateDTO(value)
}

function resolvedRef(value: unknown, entity: EntityKindDTO): value is Extract<EntityRefDTO, { state: 'resolved' }> {
  return object(value) && value.state === 'resolved' && value.entity === entity
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.label === 'string' && value.label.length > 0
    && (value.no === null || typeof value.no === 'string')
}

function sameSubject(value: unknown, subject: Record<string, unknown>): boolean {
  return object(value) && value.state === subject.state && value.entity === subject.entity
    && value.id === subject.id && value.label === subject.label && value.no === subject.no
}

function sourceNavigation(
  value: unknown,
  subject: Record<string, unknown>,
  variants: readonly string[],
  origin: string,
): value is NavigationIntentDTO {
  if (!object(value))
    return false
  if (value.kind === 'unavailable')
    return value.reason === 'unverified-target'
  return value.kind === 'source-record'
    && sameSubject(value.subject, subject)
    && typeof value.variant === 'string' && variants.includes(value.variant)
    && value.view === null && object(value.filters)
    && Object.keys(value.filters).length === 1 && value.filters.dataOrigin === origin
}

function detailNavigation(value: unknown, subject: Record<string, unknown>, origin: string): boolean {
  return object(value) && value.kind === 'entity-detail' && sameSubject(value.subject, subject)
    && value.variant === 'detail' && value.view === null && object(value.filters)
    && Object.keys(value.filters).length === 1 && value.filters.dataOrigin === origin
}

function factBase(value: unknown, entity: EntityKindDTO, variants: readonly string[], origin: string): value is Record<string, unknown> {
  if (!object(value))
    return false
  const subjectKey = entity === 'contract'
    ? 'contract'
    : entity === 'payment-application'
      ? 'application'
      : entity === 'invoice'
        ? 'invoice'
        : entity === 'payment-record'
          ? 'payment'
          : 'settlement'
  return resolvedRef(value[subjectKey], entity)
    && sourceNavigation(value.navigation, value[subjectKey] as Record<string, unknown>, variants, origin)
}

function contract(value: unknown, origin: string): boolean {
  return factBase(value, 'contract', ['detail'], origin)
    && stringFields(value, ['kind', 'status', 'amount', 'effectiveAmount'])
    && money(value.amount) && money(value.effectiveAmount) && nullableDate(value.signDate)
    && Number.isSafeInteger(value.attachmentCount) && Number(value.attachmentCount) >= 0
}

function claim(value: unknown, origin: string): boolean {
  return factBase(value, 'payment-application', ['detail'], origin)
    && stringFields(value, ['status', 'applyAmount', 'invoiceState'])
    && money(value.applyAmount) && (value.approvedAmount === null || money(value.approvedAmount)) && nullableDate(value.applyDate)
    && isApprovalReadState(value.approvedAmount, value.approvedAmountState)
    && Number.isSafeInteger(value.attachmentCount) && Number(value.attachmentCount) >= 0
}

function invoice(value: unknown, origin: string): boolean {
  return factBase(value, 'invoice', ['detail'], origin)
    && stringFields(value, ['invoiceType', 'totalAmount', 'taxAmount', 'accountStatus', 'fileName'])
    && money(value.totalAmount) && money(value.taxAmount) && nullableDate(value.invoiceDate)
}

function payment(value: unknown, origin: string): boolean {
  return factBase(value, 'payment-record', ['detail'], origin)
    && stringFields(value, ['allocatedAmount', 'paymentMethod', 'voucherNo', 'confirmationStatus'])
    && money(value.allocatedAmount) && nullableDate(value.paymentDate) && strings(value.applicationNos)
    && Number.isSafeInteger(value.attachmentCount) && Number(value.attachmentCount) >= 0
}

function settlement(value: unknown, origin: string): boolean {
  return factBase(value, 'settlement', ['material-settlement', 'subcontract-settlement', 'other-settlement'], origin)
    && stringFields(value, ['settlementType', 'totalAmount', 'status'])
    && money(value.totalAmount) && nullableDate(value.settlementDate)
    && Number.isSafeInteger(value.attachmentCount) && Number(value.attachmentCount) >= 0
}

function fileNavigation(value: unknown, origin: string): boolean {
  if (!object(value))
    return false
  if (value.kind === 'unavailable')
    return value.reason === 'missing-route' || value.reason === 'unverified-target'
  if (value.kind !== 'source-record' || !object(value.subject) || !isEntityKindDTO(value.subject.entity))
    return false
  if (!['contract', 'payment-application', 'invoice', 'payment-record', 'settlement'].includes(String(value.subject.entity)))
    return false
  const variants = value.subject.entity === 'settlement'
    ? ['material-settlement', 'subcontract-settlement', 'other-settlement']
    : ['detail']
  return resolvedRef(value.subject, value.subject.entity) && sourceNavigation(value, value.subject, variants, origin)
}

function file(value: unknown, origin: string): boolean {
  return object(value) && resolvedRef(value.file, 'file')
    && stringFields(value, ['ownerType', 'ownerId', 'sourceLabel', 'mimeType', 'category', 'uploader'])
    && fileNavigation(value.navigation, origin)
    && Number.isSafeInteger(value.fileSize) && Number(value.fileSize) >= 0
    && isISODateTimeDTO(value.uploadedAt)
    && (value.content === undefined || (object(value.content)
      && ['available', 'missing', 'not-connected'].includes(String(value.content.state))
      && (value.content.sha256 === null || (typeof value.content.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.content.sha256)))))
}

function invalid(message: string): never {
  throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('internal-error', message))
}

export function decodeProjectSupplierWorkbenchRead(value: unknown, expected?: ProjectSupplierWorkbenchQueryDTO): ProjectSupplierWorkbenchReadDTO {
  if (!object(value) || !hasConsistentReadMeta(value, 'project-supplier-read-v2', value.dataOrigin) || !isDataOriginDTO(value.dataOrigin)
    || !stringFields(value.relation, ['id', 'status', 'note'])
    || !resolvedRef(value.project, 'project') || !detailNavigation(value.projectNavigation, value.project, value.dataOrigin)
    || !stringFields(value.projectProfile, ['status', 'developer', 'manager'])
    || !resolvedRef(value.supplier, 'supplier') || !detailNavigation(value.supplierNavigation, value.supplier, value.dataOrigin)
    || !stringFields(value.supplierProfile, ['supplierCategory', 'contact', 'contactPhone'])
    || !Array.isArray(value.contracts) || !value.contracts.every(row => contract(row, value.dataOrigin as string))
    || !Array.isArray(value.claims) || !value.claims.every(row => claim(row, value.dataOrigin as string))
    || !Array.isArray(value.invoices) || !value.invoices.every(row => invoice(row, value.dataOrigin as string))
    || !Array.isArray(value.payments) || !value.payments.every(row => payment(row, value.dataOrigin as string))
    || !Array.isArray(value.settlements) || !value.settlements.every(row => settlement(row, value.dataOrigin as string))
    || !Array.isArray(value.files) || !value.files.every(row => file(row, value.dataOrigin as string))
    || !moneyFields(value.summary, ['contractTotal', 'invoiceTotal', 'taxTotal', 'paidTotal', 'settlementTotal', 'balance'])
    || !(value.summary.claimedTotal === null || money(value.summary.claimedTotal))
    || !countFields(value.counts, ['contracts', 'claims', 'invoices', 'payments', 'settlements', 'files'])
    || value.counts.contracts !== value.contracts.length || value.counts.claims !== value.claims.length
    || value.counts.invoices !== value.invoices.length || value.counts.payments !== value.payments.length
    || value.counts.settlements !== value.settlements.length || value.counts.files !== value.files.length
    || !isISODateTimeDTO(value.asOf) || !(value.sourceVersion === null || typeof value.sourceVersion === 'string')
    || !strings(value.capabilities)) {
    return invalid('中央后台返回的项目分供方工作台读模型无效')
  }
  if (expected && (value.project.id !== expected.projectId || value.supplier.id !== expected.supplierId || value.dataOrigin !== expected.origin))
    return invalid('工作台返回与本次项目、分供方或来源不一致')
  return value as unknown as ProjectSupplierWorkbenchReadDTO
}

export function serializeProjectSupplierWorkbenchQuery(query: ProjectSupplierWorkbenchQueryDTO): Record<string, string> {
  return { origin: query.origin, ...(query.includeDemo ? { includeDemo: 'true' } : {}) }
}

export function projectSupplierProblemFromUnknown(cause: unknown): ProjectSupplierRepositoryProblem {
  if (cause instanceof ProjectSupplierRepositoryProblem)
    return cause
  const remote = problemFromHttpFailure(cause)
  if (remote)
    return new ProjectSupplierRepositoryProblem(remote, { cause })
  return new ProjectSupplierRepositoryProblem(projectSupplierProblem(
    'unavailable',
    cause instanceof Error ? cause.message : '项目分供方中央读取服务暂时不可用',
    true,
  ), { cause })
}
