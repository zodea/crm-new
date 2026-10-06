import type { CustomerListItemDTO, CustomerListPageDTO, CustomerReadRepository } from '../customer/read-contract'
import type { ProjectCommandRepository, ProjectCommandRequestDTO } from './command-contract'
import { CustomerRepositoryProblem } from '../customer/repository'
import { ImportRowRejected } from '../kit/import-mapping'
import { collectReadPages } from '../read-model/collection'
import { PROJECT_WRITE_CAPABILITY } from './command-contract'
import { decodeProjectImportSource, projectDraftFromImport, projectImportSource, projectImportSourceKey } from './import'
import { projectProblemFromUnknown } from './repository'

/** 独立于编辑表单目标/草稿。准备后固定客户 ID；失败重试沿用原命令内容。 */
export function createProjectRowImporter(repository: ProjectCommandRepository, customers: CustomerReadRepository) {
  const requests = new WeakMap<Record<string, unknown>, ProjectCommandRequestDTO>()
  async function prepare(row: Record<string, unknown>) {
    const prepared = requests.get(row)
    if (prepared)
      return prepared
    const context = await repository.context()
    if (!context.capabilities.includes(PROJECT_WRITE_CAPABILITY))
      throw new ImportRowRejected('无项目导入权限')
    const collected = await collectReadPages<CustomerListPageDTO>({
      load: page => customers.list({ includeDemo: false, search: '', status: null, sort: 'name-asc', page, pageSize: 100 }),
      identity: (item: CustomerListItemDTO) => `${item.dataOrigin}:${item.customer.id}`,
    })
    const current = await repository.context()
    if (current.workspaceId !== context.workspaceId || current.actorId !== context.actorId
      || collected.first.meta.workspaceId !== current.workspaceId || collected.first.meta.actorId !== current.actorId
      || !current.capabilities.includes(PROJECT_WRITE_CAPABILITY) || !current.capabilities.includes('customer:list:read')
      || collected.items.some(item => item.dataOrigin !== 'real')) {
      throw new ImportRowRejected('导入期间权限、身份或候选来源已变化，请重新读取')
    }
    const candidates = collected.items
    let draft
    let source
    try {
      source = decodeProjectImportSource(projectImportSource(row))
      draft = projectDraftFromImport(row, candidates)
    }
    catch (cause) {
      throw new ImportRowRejected(cause instanceof Error ? cause.message : '项目导入字段无效')
    }
    const request: ProjectCommandRequestDTO = {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: PROJECT_WRITE_CAPABILITY,
      commandId: `project-excel:${projectImportSourceKey(source)}`,
      baseVersion: null,
      action: 'save',
      draft,
      attachments: {},
      importSource: source,
    }
    requests.set(row, request)
    return request
  }
  async function validate(row: Record<string, unknown>): Promise<string | null> {
    try {
      await prepare(row)
      return null
    }
    catch (cause) {
      if (cause instanceof ImportRowRejected)
        return cause.message
      const problem = cause instanceof CustomerRepositoryProblem ? cause.problem : projectProblemFromUnknown(cause).problem
      if (['forbidden', 'validation-failed', 'not-found', 'relationship-mismatch', 'conflict'].includes(problem.code))
        return problem.message
      throw cause
    }
  }
  async function importRow(row: Record<string, unknown>) {
    const request = await prepare(row)
    let result
    try {
      result = await repository.execute(request)
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause).problem
      if (['forbidden', 'validation-failed', 'not-found', 'relationship-mismatch', 'conflict'].includes(problem.code))
        throw new ImportRowRejected(problem.message)
      throw cause
    }
    // 写后回读失败也保留命令，不能把“已写入但未确认”记成可跳过的拒绝行。
    await repository.loadForm(result.id)
    return result
  }
  return { prepare, validate, importRow }
}
