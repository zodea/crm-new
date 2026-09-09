import type { DataOriginDTO, EntityKindDTO, EntityRefDTO, NavigationIntentDTO, ProblemDTO } from '../../types/read-model'
import type {
  CustomerContractDTO,
  CustomerContractSourceRow,
  CustomerDetailQueryDTO,
  CustomerDetailReadDTO,
  CustomerListItemDTO,
  CustomerListPageDTO,
  CustomerListQueryDTO,
  CustomerListSort,
  CustomerListSourceRow,
  CustomerPageSize,
  CustomerProjectDTO,
  CustomerProjectSourceRow,
  CustomerReceiptDetailQueryDTO,
  CustomerReceiptDTO,
  CustomerReceiptSourceRow,
} from './read-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { normalizeEnumSelection } from '../util/enum-selection'
import { CUSTOMER_PAGE_SIZES, customerProblem, CustomerRepositoryProblem } from './read-contract'

interface BuildCustomerListPageOptions {
  rows: readonly CustomerListSourceRow[]
  query: CustomerListQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: string[]
}

interface BuildCustomerDetailReadOptions {
  projectsProblem?: ProblemDTO
  customers: readonly CustomerListSourceRow[]
  projects: readonly CustomerProjectSourceRow[]
  contracts: readonly CustomerContractSourceRow[]
  receipts: readonly CustomerReceiptSourceRow[]
  query: CustomerDetailQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: string[]
}

function one(value: unknown): string | undefined {
  if (typeof value === 'string')
    return value
  if (Array.isArray(value) && typeof value[0] === 'string')
    return value[0]
  return undefined
}

function positiveInteger(value: unknown, fallback: number): number {
  const raw = one(value)
  if (!raw || !/^\d+$/.test(raw))
    return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parseCustomerListQuery(
  input: Record<string, unknown> | undefined,
): CustomerListQueryDTO {
  const sort = one(input?.sort)
  const pageSize = positiveInteger(input?.pageSize, 10)
  if (!CUSTOMER_PAGE_SIZES.includes(pageSize as CustomerPageSize)) {
    throw new CustomerRepositoryProblem(customerProblem(
      'invalid-query',
      '客户列表每页条数无效',
    ))
  }
  const includeDemo = one(input?.includeDemo)
  if (includeDemo != null && includeDemo !== 'true' && includeDemo !== 'false') {
    throw new CustomerRepositoryProblem(customerProblem(
      'invalid-query',
      '客户列表测试数据参数无效',
    ))
  }
  const allowedSorts = new Set<CustomerListSort>(['updated-desc', 'name-asc', 'name-desc'])
  return {
    includeDemo: includeDemo === 'true',
    search: one(input?.search)?.trim().slice(0, 120) ?? '',
    status: customerStatuses(input?.status),
    sort: allowedSorts.has(sort as CustomerListSort)
      ? sort as CustomerListSort
      : 'updated-desc',
    page: positiveInteger(input?.page, 1),
    pageSize: pageSize as CustomerPageSize,
  }
}

function customerStatuses(value: unknown): string[] | null {
  try {
    const values = normalizeEnumSelection(value)
    if (values.some(item => item.length > 48))
      throw new Error('status is too long')
    return values.length ? values : null
  }
  catch {
    throw new CustomerRepositoryProblem(customerProblem('invalid-query', '客户列表状态筛选无效'))
  }
}

export function parseCustomerDetailQuery(
  id: string,
  input: Record<string, unknown> | undefined,
): CustomerDetailQueryDTO {
  const origin = one(input?.origin)
  const includeDemo = one(input?.includeDemo)
  if (!id.trim() || !isDataOriginDTO(origin)
    || (includeDemo != null && includeDemo !== 'true' && includeDemo !== 'false')) {
    throw new CustomerRepositoryProblem(customerProblem(
      'invalid-query',
      '客户详情查询参数无效',
    ))
  }
  return {
    id,
    origin,
    includeDemo: includeDemo === 'true',
  }
}

export function parseCustomerReceiptDetailQuery(
  id: string,
  input: Record<string, unknown> | undefined,
): CustomerReceiptDetailQueryDTO {
  const base = parseCustomerDetailQuery(id, input)
  const customerId = one(input?.customerId)?.trim()
  if (!customerId) {
    throw new CustomerRepositoryProblem(customerProblem(
      'invalid-query',
      '收款详情缺少父客户身份',
    ))
  }
  return { ...base, customerId }
}

function toListItem(row: CustomerListSourceRow): CustomerListItemDTO {
  const customer: CustomerListItemDTO['customer'] = {
    state: 'resolved',
    entity: 'customer',
    id: row.id,
    label: row.name,
    no: row.taxNo || null,
  }
  return {
    dataOrigin: row.dataOrigin,
    customer,
    navigation: {
      kind: 'entity-detail',
      subject: customer,
      variant: 'detail',
      view: null,
      filters: { dataOrigin: row.dataOrigin },
    },
    aliases: [...row.aliases],
    taxNo: row.taxNo,
    contact: row.contact,
    contactPhone: row.contactPhone,
    status: row.status,
    updatedAt: row.updatedAt,
  }
}

export function buildCustomerListPage(
  options: BuildCustomerListPageOptions,
): CustomerListPageDTO {
  const visibleByOrigin = options.rows.filter(row =>
    row.dataOrigin === 'real' || options.query.includeDemo,
  )
  const needle = options.query.search.toLocaleLowerCase('zh-CN')
  const statuses = customerStatuses(options.query.status) ?? []
  const candidates = visibleByOrigin.filter((row) => {
    const matchesSearch = !needle || [
      row.name,
      ...row.aliases,
      row.taxNo,
      row.contact,
    ].some(value => value.toLocaleLowerCase('zh-CN').includes(needle))
    return matchesSearch
  })
  const filtered = candidates.filter(row => !statuses.length || statuses.includes(row.status))
  const sorted = [...filtered].sort((left, right) => {
    if (options.query.sort === 'name-asc')
      return left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
    if (options.query.sort === 'name-desc')
      return right.name.localeCompare(left.name, 'zh-CN') || left.id.localeCompare(right.id)
    return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  })
  const page = Math.min(options.query.page, Math.max(1, Math.ceil(filtered.length / options.query.pageSize)))
  const start = (page - 1) * options.query.pageSize
  const statusCounts = new Map<string, number>()
  for (const row of candidates)
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1)
  const countOrigin = (origin: CustomerListSourceRow['dataOrigin']) =>
    filtered.filter(row => row.dataOrigin === origin).length
  const hasSourceRecords = visibleByOrigin.length > 0
  return {
    items: sorted.slice(start, start + options.query.pageSize).map(toListItem),
    pagination: {
      page,
      pageSize: options.query.pageSize,
      total: sorted.length,
    },
    summary: {
      statuses: [...statusCounts.entries()]
        .map(([value, count]) => ({ value, label: value || '未登记', count }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
      origins: {
        real: { customerCount: countOrigin('real') },
        demo: { customerCount: countOrigin('demo') },
      },
    },
    empty: sorted.length
      ? null
      : {
          reason: hasSourceRecords ? 'no-filter-match' : 'no-records',
          missingRelations: [],
        },
    asOf: options.asOf,
    sourceVersion: options.sourceVersion,
    capabilities: [...options.capabilities],
  }
}

function money(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2)
}

function isDraft(status: string): boolean {
  return status === 'draft' || status === '草稿'
}

function resolvedRef(
  entity: EntityKindDTO,
  id: string,
  label: string,
  no: string | null = null,
): Extract<EntityRefDTO, { state: 'resolved' }> {
  return { state: 'resolved', entity, id, label, no }
}

function missingRef(entity: EntityKindDTO): Extract<EntityRefDTO, { state: 'missing' }> {
  return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
}

function forbiddenRef(
  entity: EntityKindDTO,
): Extract<EntityRefDTO, { state: 'forbidden' }> {
  return { state: 'forbidden', entity, id: null, label: null, reason: 'permission-denied' }
}

function unavailable(reason: 'missing-id' | 'forbidden'): NavigationIntentDTO {
  return { kind: 'unavailable', reason }
}

function detailIntent(
  subject: Extract<EntityRefDTO, { state: 'resolved' }>,
  dataOrigin?: DataOriginDTO,
  filters: Record<string, string> = {},
): NavigationIntentDTO {
  return {
    kind: 'entity-detail',
    subject,
    variant: 'detail',
    view: null,
    filters: dataOrigin ? { dataOrigin, ...filters } : filters,
  }
}

function refAndNavigation(
  entity: 'project' | 'contract',
  id: string | null,
  labels: ReadonlyMap<string, string>,
  forbiddenIds: ReadonlySet<string>,
  dataOrigin: DataOriginDTO,
  filters: Record<string, string> = {},
): { ref: EntityRefDTO, navigation: NavigationIntentDTO } {
  if (!id)
    return { ref: missingRef(entity), navigation: unavailable('missing-id') }
  if (forbiddenIds.has(id))
    return { ref: forbiddenRef(entity), navigation: unavailable('forbidden') }
  const label = labels.get(id)
  if (!label)
    return { ref: missingRef(entity), navigation: unavailable('missing-id') }
  const ref = resolvedRef(entity, id, label)
  return {
    ref,
    navigation: detailIntent(ref, entity === 'project' ? dataOrigin : undefined, filters),
  }
}

export function buildCustomerDetailRead(
  options: BuildCustomerDetailReadOptions,
): CustomerDetailReadDTO {
  if (options.query.origin === 'demo' && !options.query.includeDemo) {
    throw new CustomerRepositoryProblem(customerProblem(
      'forbidden',
      '测试客户未授权显示',
    ))
  }
  const customer = options.customers.find(row =>
    row.id === options.query.id && row.dataOrigin === options.query.origin,
  )
  if (!customer) {
    const sameId = options.customers.some(row => row.id === options.query.id)
    throw new CustomerRepositoryProblem(customerProblem(
      sameId ? 'relationship-mismatch' : 'not-found',
      sameId ? '客户来源与地址不匹配' : '客户不存在或已删除',
    ))
  }

  const originProjects = options.projectsProblem ? [] : options.projects.filter(row => row.dataOrigin === customer.dataOrigin)
  const projectRows = originProjects.filter(row =>
    row.permission !== 'forbidden'
    && (row.customerId === customer.id || row.secondaryCustomerId === customer.id),
  )
  const contractRows = options.contracts.filter(row =>
    row.dataOrigin === customer.dataOrigin
    && row.customerId === customer.id,
  )
  const receiptRows = options.receipts.filter(row =>
    row.dataOrigin === customer.dataOrigin
    && row.customerId === customer.id,
  )
  const projectLabels = new Map(originProjects.map(row => [row.id, row.name]))
  const forbiddenProjects = new Set(
    originProjects.filter(row => row.permission === 'forbidden').map(row => row.id),
  )
  const contractLabels = new Map(
    options.contracts
      .filter(row => row.dataOrigin === customer.dataOrigin)
      .map(row => [row.id, row.name]),
  )
  const contractsByProject = new Map<string, { count: number, amount: number }>()
  for (const row of contractRows) {
    if (!row.projectId)
      continue
    const fact = contractsByProject.get(row.projectId) ?? { count: 0, amount: 0 }
    fact.count += 1
    if (!isDraft(row.status))
      fact.amount += row.amount + row.supplementAmount
    contractsByProject.set(row.projectId, fact)
  }
  const receiptsByProject = new Map<string, { count: number, amount: number }>()
  for (const row of receiptRows) {
    if (!row.projectId)
      continue
    const fact = receiptsByProject.get(row.projectId) ?? { count: 0, amount: 0 }
    fact.count += 1
    if (!isDraft(row.status))
      fact.amount += row.amount
    receiptsByProject.set(row.projectId, fact)
  }

  const projects: CustomerProjectDTO[] = projectRows.map((row) => {
    const contractFact = contractsByProject.get(row.id) ?? { count: 0, amount: 0 }
    const receiptFact = receiptsByProject.get(row.id) ?? { count: 0, amount: 0 }
    const ref = resolvedRef('project', row.id, row.name, row.code || null)
    return {
      project: ref as CustomerProjectDTO['project'],
      navigation: detailIntent(ref, row.dataOrigin, { customerId: customer.id }),
      code: row.code,
      relationRole: row.customerId === customer.id ? '主客户' : '次客户',
      status: row.status,
      startDate: row.startDate,
      plannedEnd: row.plannedEnd,
      manager: row.manager,
      contractCount: contractFact.count,
      effectiveContractAmount: money(contractFact.amount),
      receiptCount: receiptFact.count,
      effectiveReceiptAmount: money(receiptFact.amount),
    }
  })

  const contracts: CustomerContractDTO[] = contractRows.map((row) => {
    const project = refAndNavigation(
      'project',
      row.projectId,
      projectLabels,
      forbiddenProjects,
      row.dataOrigin,
      { customerId: customer.id },
    )
    const contractRef = resolvedRef('contract', row.id, row.name, row.no || null)
    const effectiveAmount = isDraft(row.status) ? 0 : row.amount + row.supplementAmount
    return {
      contract: contractRef as CustomerContractDTO['contract'],
      navigation: detailIntent(contractRef),
      project: project.ref as CustomerContractDTO['project'],
      projectNavigation: project.navigation,
      effectiveAmount: money(effectiveAmount),
      receiptAmount: money(row.receiptAmount),
      outstandingAmount: money(effectiveAmount - row.receiptAmount),
      signDate: row.signDate,
      status: row.status,
      isDraft: isDraft(row.status),
    }
  })

  const receipts: CustomerReceiptDTO[] = receiptRows.map((row) => {
    const project = refAndNavigation(
      'project',
      row.projectId,
      projectLabels,
      forbiddenProjects,
      row.dataOrigin,
      { customerId: customer.id },
    )
    const contract = refAndNavigation(
      'contract',
      row.contractId,
      contractLabels,
      new Set(),
      row.dataOrigin,
    )
    const receiptRef = resolvedRef('receipt', row.id, row.no || row.id, row.no || null)
    return {
      receipt: receiptRef as CustomerReceiptDTO['receipt'],
      navigation: {
        ...detailIntent(receiptRef, row.dataOrigin),
        filters: { dataOrigin: row.dataOrigin, customerId: customer.id },
      },
      project: project.ref as CustomerReceiptDTO['project'],
      projectNavigation: project.navigation,
      contract: contract.ref as CustomerReceiptDTO['contract'],
      contractNavigation: contract.navigation,
      receiptDate: row.receiptDate,
      payerAccount: row.payerAccount,
      amount: money(row.amount),
      effectiveAmount: money(isDraft(row.status) ? 0 : row.amount),
      paymentMethod: row.paymentMethod,
      status: row.status,
      isDraft: isDraft(row.status),
    }
  })
  const effectiveContractAmount = contracts.reduce(
    (sum, row) => sum + Number(row.effectiveAmount),
    0,
  )
  const effectiveReceiptAmount = receipts.reduce(
    (sum, row) => sum + Number(row.effectiveAmount),
    0,
  )
  return {
    dataOrigin: customer.dataOrigin,
    customer: { ...customer, aliases: [...customer.aliases] },
    ...(options.projectsProblem ? { projectsProblem: options.projectsProblem } : {}),
    projects,
    contracts,
    receipts,
    summary: {
      projectCount: options.projectsProblem ? null : projects.length,
      contractCount: contracts.length,
      effectiveContractAmount: money(effectiveContractAmount),
      receiptCount: receipts.length,
      effectiveReceiptAmount: money(effectiveReceiptAmount),
      outstandingAmount: money(effectiveContractAmount - effectiveReceiptAmount),
      draftReceiptCount: receipts.filter(row => row.isDraft).length,
    },
    asOf: options.asOf,
    sourceVersion: options.sourceVersion,
    capabilities: [...options.capabilities],
  }
}
