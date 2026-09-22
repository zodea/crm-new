import type { CustomerListItemDTO } from '../../app/lib/customer/read-contract'
import type { ProjectFormDraft } from '../../app/lib/master-data/forms'
import type { ProjectListSourceRow } from '../../app/lib/project/repository'
import type { BusinessSession } from './business-session'
import { CustomerRepositoryProblem } from '../../app/lib/customer/repository'
import { assertImportCustomerAvailable } from '../../app/lib/project/import'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { customerReadTestInstance } from './customer-read-test-instance'

/** 同一中央可读集合；包含删除/迁移/权限边界，不使用浏览器候选或本地 SQL。 */
async function formalCustomers(sessionId?: string | null) {
  const customers: CustomerListItemDTO[] = []
  for (let page = 1; ; page++) {
    const result = await customerReadTestInstance.list({ includeDemo: 'false', page: String(page), pageSize: '100' }, sessionId)
    customers.push(...result.items)
    if (page * 100 >= result.pagination.total)
      break
  }
  return customers
}

export async function assertProjectImportCustomers(draft: ProjectFormDraft, session: BusinessSession, sessionId?: string | null): Promise<void> {
  if (!session.capabilities.includes('customer:list:read'))
    throw new ProjectRepositoryProblem(projectProblem('forbidden', '无客户查看权限，不能导入项目关系'))
  const customers = await formalCustomers(sessionId)
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

export async function resolveProjectCustomerReferences(rows: readonly ProjectListSourceRow[], sessionId?: string | null): Promise<readonly ProjectListSourceRow[]> {
  if (!rows.some(row => row.dataOrigin === 'real' && (row.customerId || row.secondaryCustomerId)))
    return rows
  let customers: CustomerListItemDTO[] = []
  let forbidden = false
  try {
    customers = await formalCustomers(sessionId)
  }
  catch (cause) {
    if (cause instanceof CustomerRepositoryProblem && cause.problem.code === 'forbidden')
      forbidden = true
    else throw cause
  }
  const name = (id: string | null) => {
    const matches = customers.filter(customer => customer.dataOrigin === 'real' && customer.customer.id === id)
    return matches.length === 1 ? matches[0]!.customer.label : null
  }
  return rows.map(row => row.dataOrigin === 'demo'
    ? row
    : {
        ...row,
        customerName: name(row.customerId),
        secondaryCustomerName: name(row.secondaryCustomerId),
        customerPermission: forbidden ? 'forbidden' : row.customerPermission,
        secondaryCustomerPermission: forbidden ? 'forbidden' : row.secondaryCustomerPermission,
      })
}
