import type { TargetCostCommand, TargetCostCommandResult, TargetCostDetailRead, TargetCostFileRead, TargetCostFormRead, TargetCostListRead, TargetCostQuery } from './central-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { TARGET_COST_MONEY_FIELDS, targetCostProblem } from './central-contract'
import { parseBudgetFileChanges } from './central-files'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function fail(message = '预算服务返回的数据不完整'): never {
  throw targetCostProblem('unavailable', message)
}
function text(value: unknown): value is string {
  return typeof value === 'string'
}
function nullableText(value: unknown) {
  return value === null || text(value)
}
function nullableAmount(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text)
}
const AMOUNTS = new Set<string>([...TARGET_COST_MONEY_FIELDS, 'unitPrice', 'amount', 'itemTotal', 'targetAmount'])
const statuses = new Set(['complete', 'partial', 'pending', 'not-applicable', 'undefined'])
function money(value: unknown): number | null {
  if (value === null)
    return null
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value) || !Number.isFinite(Number(value)))
    fail('预算金额格式无效')
  return Number(value)
}
/** 审计原始前后快照不属于展示金额字段，保持原始列和值。 */
export function encodeTargetCostWire(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(encodeTargetCostWire)
  if (!object(value))
    return value
  const metric = 'knownValue' in value && 'missingSources' in value
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, ['history', 'beforeData', 'afterData'].includes(key) ? child : key === 'qty' && typeof child === 'number' ? String(child) : ((AMOUNTS.has(key) || (metric && ['value', 'knownValue'].includes(key))) && typeof child === 'number') ? child.toFixed(2) : encodeTargetCostWire(child)]))
}
function decodeNumbers(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(decodeNumbers)
  if (!object(value))
    return value
  const metric = 'knownValue' in value && 'missingSources' in value
  if (metric && (!statuses.has(String(value.status)) || !strings(value.missingSources)))
    fail()
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ['history', 'beforeData', 'afterData'].includes(key) ? child : key === 'qty' ? quantity(child) : AMOUNTS.has(key) || (metric && ['value', 'knownValue'].includes(key)) ? money(child) : decodeNumbers(child)]))
}
function quantity(value: unknown): number | null {
  if (value === null)
    return null
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
    fail('预算数量格式无效')
  return Number(value)
}
function metric(value: unknown) {
  return object(value) && (value.value === null || typeof value.value === 'number') && (value.knownValue === null || typeof value.knownValue === 'number') && statuses.has(String(value.status)) && strings(value.missingSources) && (value.status !== 'complete' || typeof value.value === 'number')
}
function metrics(value: Record<string, unknown>) {
  return ['signedAmount', 'settledAmount', 'paidAmount', 'remainingAmount'].every(key => metric(value[key]))
}
function sources(value: unknown, projectId: unknown, origin: unknown, category: unknown) {
  return object(value) && ['contract', 'settlement', 'payment', 'reimbursement'].every((key) => {
    const source = value[key]
    if (object(source) && source.entity === 'wage-statement')
      return key === 'payment' && category === '工人工资' && origin === 'real' && source.kind === 'entity-list' && source.variant === 'actual-ledger' && source.view === null && object(source.filters) && source.filters.projectId === projectId && source.filters.dataOrigin === origin && source.filters.costCategory === category
    return source === null || (object(source) && source.kind === 'entity-list' && ['contract', 'settlement', 'subcontract-document'].includes(String(source.entity)) && ['material', 'subcontract', 'other_expense', 'settlement', 'other_settlement'].includes(String(source.variant)) && object(source.filters) && source.filters.projectId === projectId && source.filters.dataOrigin === origin && source.filters.costCategory === category)
  })
}
function detailHeader(value: unknown, id: string | null) {
  return object(value) && value.id === id && nullableText(value.projectId) && ['name', 'projectName', 'projectCode', 'status', 'note'].every(key => text(value[key])) && typeof value.isBaseline === 'boolean' && TARGET_COST_MONEY_FIELDS.every(key => value[key] === null || typeof value[key] === 'number')
}
function checkContext(value: Record<string, unknown>, query: TargetCostQuery) {
  const context = value.context
  if (!object(context) || !text(context.workspaceId) || !text(context.actorId) || !text(context.sourceVersion) || !strings(context.capabilities) || context.origin !== query.origin || !context.capabilities.includes('target-cost:read'))
    fail()
}
function checkFiles(value: unknown, id: string | null) {
  if (!Array.isArray(value) || !value.every(file => object(file) && text(file.id) && file.ownerType === 'target_cost' && file.ownerId === id && text(file.fileName) && (file.fileSize === null || (typeof file.fileSize === 'number' && file.fileSize >= 0)) && text(file.mimeType) && text(file.category) && text(file.uploader) && nullableText(file.uploadedAt) && nullableText(file.deletedAt) && ['available', 'missing'].includes(String(file.payloadState))))
    fail()
}
export function decodeTargetCostRead<T extends TargetCostListRead | TargetCostFormRead | TargetCostDetailRead | TargetCostFileRead>(input: unknown, kind: 'list' | 'form' | 'detail' | 'file', query: TargetCostQuery, id: string | null = null, fileId?: string): T {
  if (!object(input))
    fail()
  checkContext(input, query)
  const value = decodeNumbers(input) as Record<string, unknown>
  if (kind === 'list') {
    if (!Array.isArray(value.rows) || !value.rows.every(row => object(row) && text(row.id) && nullableText(row.projectId) && text(row.name) && text(row.projectName) && typeof row.isBaseline === 'boolean' && nullableText(row.deletedAt) && TARGET_COST_MONEY_FIELDS.every(key => row[key] === null || typeof row[key] === 'number') && (row.profitRate === null || typeof row.profitRate === 'number') && text(row.status) && text(row.updatedAt)))
      fail()
  }
  else if (kind === 'form') {
    if (value.targetCostId !== id || !object(value.draft) || !nullableText(value.draftKey) || !nullableText(value.deletedAt) || !Array.isArray(value.projects) || !value.projects.every(row => object(row) && text(row.id) && text(row.code) && text(row.name)) || !['available', 'forbidden', 'unavailable'].includes(String(value.projectOptionsStatus)))
      fail()
    checkFiles(value.files, id)
  }
  else if (kind === 'detail') {
    if (value.targetCostId !== id || !nullableText(value.deletedAt) || !object(value.view) || !detailHeader(value.view.header, id) || !Array.isArray(value.view.items) || !value.view.items.every(row => object(row) && text(row.id) && text(row.category) && text(row.itemName) && text(row.unit) && nullableAmount(row.qty) && nullableAmount(row.unitPrice) && nullableAmount(row.amount)) || !Array.isArray(value.view.categories) || !value.view.categories.every(row => object(row) && text(row.id) && text(row.category) && nullableAmount(row.targetAmount) && metrics(row) && sources(row.sources, (value.view as { header: { projectId: unknown } }).header.projectId, query.origin, row.category)) || !object(value.view.summary) || !nullableAmount(value.view.summary.itemTotal) || !metrics(value.view.summary) || !Array.isArray(value.history) || !text(value.actualSourceVersion))
      fail()
    checkFiles(value.files, id)
  }
  else {
    const content = value.content
    if (!object(content) || content.targetCostId !== id || content.fileId !== fileId || !text(content.fileName) || !text(content.mimeType) || (content.fileSize !== null && typeof content.fileSize !== 'number') || (content.state === 'available' ? !text(content.payloadBase64) || !text(content.sha256) : content.state !== 'missing' || content.reason !== 'missing-payload'))
      fail()
  }
  return value as unknown as T
}
export function decodeTargetCostResult(value: unknown, command: TargetCostCommand): TargetCostCommandResult {
  if (!object(value) || value.commandId !== command.commandId || !text(value.id) || (command.targetCostId && value.id !== command.targetCostId) || !text(value.sourceVersion) || !strings(value.logIds) || !strings(value.attachmentIds) || !strings(value.affectedVersionIds) || !value.affectedVersionIds.includes(value.id))
    fail('预算提交回执与原目标不一致')
  return value as unknown as TargetCostCommandResult
}
export function parseTargetCostQuery(input: Record<string, unknown>): TargetCostQuery {
  const origin = input.origin ?? 'real'
  if (!isDataOriginDTO(origin))
    throw targetCostProblem('invalid-query', '预算数据来源无效')
  return { origin, includeDemo: input.includeDemo === 'true' || input.includeDemo === true }
}
export function parseTargetCostCommand(input: unknown): TargetCostCommand {
  const invalid = () => {
    throw targetCostProblem('validation-failed', '预算提交内容格式无效')
  }
  if (!object(input) || !['commandId', 'workspaceId', 'actorId', 'sourceVersion'].every(key => typeof input[key] === 'string' && String(input[key]).trim()) || !nullableText(input.targetCostId) || !isDataOriginDTO(input.origin) || input.requiredCapability !== 'target-cost:write' || !object(input.action))
    return invalid()
  const action = input.action
  if (action.kind === 'save-header') {
    if (!object(action.draft) || !['draft', 'save', 'submit'].includes(String(action.saveAction)) || (action.draft.isBaseline !== undefined && typeof action.draft.isBaseline !== 'boolean') || (action.draft.projectId != null && typeof action.draft.projectId !== 'string'))
      return invalid()
    for (const key of ['id', 'name', 'note', 'status']) {
      if (action.draft[key] != null && typeof action.draft[key] !== 'string')
        return invalid()
    }
    if (action.files !== undefined)
      parseBudgetFileChanges(action.files)
  }
  else if (action.kind === 'save-items') {
    if (!Array.isArray(action.items) || !action.items.every(item => object(item) && ['id', 'category', 'itemName', 'unit', 'note'].every(key => item[key] == null || typeof item[key] === 'string')))
      return invalid()
  }
  else if (!['delete', 'restore'].includes(String(action.kind))) {
    return invalid()
  }
  if (input.draftKey !== undefined && !text(input.draftKey))
    return invalid()
  try {
    return decodeNumbers(input) as TargetCostCommand
  }
  catch {
    return invalid()
  }
}
