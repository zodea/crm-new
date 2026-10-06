import type { CustomerListItemDTO, CustomerListPageDTO } from '../../app/lib/customer/read-contract'
import type { ProjectFormDraft } from '../../app/lib/master-data/forms'
import type { ProjectListSourceRow } from '../../app/lib/project/repository'
import type { SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { CustomerRepositoryProblem } from '../../app/lib/customer/repository'
import { assertImportCustomerAvailable } from '../../app/lib/project/import'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { collectReadPages } from '../../app/lib/read-model/collection'
import { customerReadTestInstance } from './customer-read-test-instance'

/** 同一中央可读集合；包含删除/迁移/权限边界，不使用浏览器候选或本地 SQL。 */
async function formalCustomers(sessionId?: string | null) {
  try {
    const result = await collectReadPages<CustomerListPageDTO>({
      load: page => customerReadTestInstance.list({ includeDemo: 'false', page: String(page), pageSize: '100' }, sessionId),
      identity: (item: CustomerListItemDTO) => `${item.dataOrigin}:${item.customer.id}`,
    })
    if (result.items.some(item => item.dataOrigin !== 'real'))
      throw new Error('正式候选混入其他来源')
    return { items: result.items, source: { key: 'customers', state: 'readable' as const, sourceVersion: result.first.meta.sourceVersion, asOf: result.first.meta.asOf } }
  }
  catch (cause) {
    if (cause instanceof CustomerRepositoryProblem)
      throw cause
    throw new CustomerRepositoryProblem({ code: 'unavailable', message: cause instanceof Error ? cause.message : '客户候选读取不完整', retryable: true, fieldErrors: {}, traceId: null })
  }
}

export async function assertProjectImportCustomers(draft: ProjectFormDraft, session: BusinessSession, sessionId?: string | null): Promise<void> {
  if (!session.capabilities.includes('customer:list:read'))
    throw new ProjectRepositoryProblem(projectProblem('forbidden', '无客户查看权限，不能导入项目关系'))
  const { items: customers } = await formalCustomers(sessionId)
  for (const [id, label] of [[draft.customerId, '客户'], [draft.secondaryCustomerId, '次客户']]) {
    if (!id)
      continue
    const matches = customers.filter(item => item.dataOrigin === 'real' && item.customer.id === id)
    if (matches.length !== 1)
      throw new ProjectRepositoryProblem(projectProblem('validation-failed', `${label}身份已失效、存在歧义或不在正式可读范围内，请核对后重试`))
    try {
      assertImportCustomerAvailable(matches[0]!, label ?? '客户')
    }
    catch (cause) {
      throw new ProjectRepositoryProblem(projectProblem('validation-failed', cause instanceof Error ? cause.message : '客户已停用'))
    }
  }
}

export async function resolveProjectCustomerReferences(rows: readonly ProjectListSourceRow[], sessionId?: string | null): Promise<{ rows: readonly ProjectListSourceRow[], source: SourceEvidenceDTO }> {
  if (!rows.some(row => row.dataOrigin === 'real' && (row.customerId || row.secondaryCustomerId)))
    return { rows, source: { key: 'customers', state: 'not-requested', sourceVersion: null, asOf: null } }
  let customers: CustomerListItemDTO[] = []
  let source: SourceEvidenceDTO = { key: 'customers', state: 'unavailable', sourceVersion: null, asOf: null }
  let access: 'forbidden' | 'unavailable' | null = null
  try {
    const result = await formalCustomers(sessionId)
    customers = result.items
    source = result.source
  }
  catch (cause) {
    if (cause instanceof CustomerRepositoryProblem && ['forbidden', 'unavailable'].includes(cause.problem.code)) {
      access = cause.problem.code === 'forbidden' ? 'forbidden' : 'unavailable'
      source = { key: 'customers', state: access, sourceVersion: null, asOf: null }
    }
    else {
      throw cause
    }
  }
  const name = (id: string | null) => {
    const matches = customers.filter(customer => customer.dataOrigin === 'real' && customer.customer.id === id)
    return matches.length === 1 ? matches[0]!.customer.label : null
  }
  return { source, rows: rows.map(row => row.dataOrigin === 'demo'
    ? row
    : {
        ...row,
        customerName: name(row.customerId),
        secondaryCustomerName: name(row.secondaryCustomerId),
        customerPermission: access ?? row.customerPermission,
        secondaryCustomerPermission: access ?? row.secondaryCustomerPermission,
      }) }
}
