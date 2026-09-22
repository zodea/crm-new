import type { QuantityCommand, QuantityContext } from './central-contract'
import type { QuantityRepository } from './central-repository'
import type { QuantityImportTarget } from './import-contract'
import { ImportRowRejected } from '../kit/import-mapping'
import { loadQuantityBrowserCatalog } from './browser-catalog'
import { quantityProblem, QuantityRepositoryProblem } from './central-contract'
import { normalizeQuantityImportRow, resolveQuantityImportAssignee, resolveQuantityImportUnit } from './import-contract'

interface Dependencies {
  context: () => Promise<QuantityContext>
  projects: Parameters<typeof loadQuantityBrowserCatalog>[0]['list']
  quantity: Pick<QuantityRepository, 'region' | 'templates' | 'assignments' | 'completion' | 'execute'>
}

function rowFailure(cause: unknown): never {
  if (cause instanceof QuantityRepositoryProblem && ['forbidden', 'validation-failed', 'not-found', 'relationship-mismatch', 'conflict', 'stale-source'].includes(cause.problem.code))
    throw new ImportRowRejected(cause.message)
  throw cause
}

/** 每个文件行只准备一次身份、版本与命令；写后回读失败仍停在此行，以同一命令恢复。 */
export function createQuantityRowImporter(dependencies: Dependencies) {
  const requests = new WeakMap<Record<string, unknown>, Map<QuantityImportTarget, Promise<QuantityCommand>>>()

  async function prepare(target: QuantityImportTarget, snapshot: Record<string, unknown>): Promise<QuantityCommand> {
    const row = normalizeQuantityImportRow(target, snapshot)
    const context = await dependencies.context()
    if (!['quantity:read', 'quantity:write', 'project:list:read'].every(capability => context.capabilities.includes(capability)))
      throw quantityProblem('forbidden', '当前身份无权导入工程量')
    const projects = await loadQuantityBrowserCatalog({ list: dependencies.projects, demo: async () => [] }, { includeDemo: false, capabilities: context.capabilities })
    const matches = projects.filter(project => project.code === row.projectCode)
    if (matches.length !== 1)
      throw quantityProblem('validation-failed', `项目编码「${row.projectCode}」${matches.length ? '不唯一' : '不在当前可读正式项目中'}，请先核对项目目录`)
    const projectId = matches[0]!.id
    const query = { projectId, origin: 'real' as const, includeDemo: false }
    const region = await dependencies.quantity.region(query)
    const unitId = target === 'template' ? null : resolveQuantityImportUnit(region.data, row)
    let assignee = null
    let baseVersion = region.sourceVersion
    if (target === 'assignment') {
      const workspace = await dependencies.quantity.assignments(query)
      if (workspace.sourceVersion !== baseVersion)
        throw quantityProblem('stale-source', '读取责任候选时工程量已变化，请重新核对文件行')
      assignee = resolveQuantityImportAssignee(workspace.data.assignees, row)
      baseVersion = workspace.sourceVersion
    }
    return { workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: 'quantity:write', commandId: crypto.randomUUID(), baseVersion, origin: 'real', projectId, action: { kind: 'import-row', target, row, unitId, assignee } }
  }

  return async (target: QuantityImportTarget, row: Record<string, unknown>): Promise<void> => {
    let targets = requests.get(row)
    if (!targets) {
      targets = new Map()
      requests.set(row, targets)
    }
    let pending = targets.get(target)
    if (!pending) {
      const snapshot = { ...row }
      pending = prepare(target, snapshot).catch((cause) => {
        targets!.delete(target)
        throw cause
      })
      targets.set(target, pending)
    }
    let request: QuantityCommand
    let saved
    try {
      request = await pending
      saved = await dependencies.quantity.execute(request)
    }
    catch (cause) { return rowFailure(cause) }
    const query = { projectId: request.projectId, origin: 'real' as const, includeDemo: false }
    // 此处失败不能转为被拒绝行：写入可能已成功，保留原命令等待重试及真实回读。
    if (target === 'template') {
      const read = await dependencies.quantity.templates(query)
      if (!read.data.templates.some(template => template.id === saved.id))
        throw quantityProblem('unavailable', '导入模板尚未在中央回读中出现，请重试核对')
    }
    else if (target === 'assignment') {
      const read = await dependencies.quantity.assignments(query)
      if (!saved.assignments || saved.assignments.assignmentIds.some(id => !read.data.assignments.some(assignment => assignment.id === id)))
        throw quantityProblem('unavailable', '导入责任尚未在中央回读中出现，请重试核对')
    }
    else {
      const action = request.action
      if (action.kind !== 'import-row' || !action.unitId)
        throw quantityProblem('internal-error', '导入目标户身份丢失')
      const read = await dependencies.quantity.completion({ ...query, unitId: action.unitId })
      if (!read.data.stages.some(stage => stage.completion?.id === saved.id && stage.completion.status === saved.completion?.status))
        throw quantityProblem('unavailable', '导入施工记录尚未在中央回读中出现，请重试核对')
    }
  }
}
