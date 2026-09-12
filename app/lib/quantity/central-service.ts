import type { TransactionDb } from '../db/coordinator'
import type { QuantityBoqSource, QuantityBoqWorkspace } from './central-boq'
import type { QuantityBatchReadQuery, QuantityCommand, QuantityCommandResult, QuantityContext, QuantityReadQuery, QuantityReadResult, QuantityRegionAction, QuantityUnitReadQuery } from './central-contract'
import type { QuantityMonthlyBoqFact, QuantityMonthlyReadQuery } from './central-monthly'
import type { QuantityPeopleSource } from './central-people'
import type { QuantityPhotoIdentity } from './central-photo'
import type { QuantityDatabase } from './central-transaction'
import type { QuantityRegionWorkspace } from './region'
import type { QuantityTemplateWorkspace } from './template'
import { loadQuantityAssignmentWorkspace } from './assignment'
import { loadQuantityBatchCompletionPlan } from './batch-completion'
import { parseQuantityArchiveAction, persistQuantityArchive } from './central-archive'
import { parseQuantityAssignmentAction, persistQuantityAssignmentAction, validateQuantityAssignmentParent } from './central-assignment-action'
import { parseQuantityCompletionAction, persistQuantityCompletionAction, validateQuantityCompletionParent } from './central-completion-action'
import { QUANTITY_READ_CAPABILITY, QUANTITY_WRITE_CAPABILITY, quantityProblem } from './central-contract'
import { persistQuantityImport, validateQuantityImportParent } from './central-import'
import { loadQuantityMonthlyBoqFacts } from './central-monthly'
import { synchronizeQuantityPeople } from './central-people'
import { readQuantityCentralPhoto } from './central-photo'
import { loadQuantityStageWorkspace, parseQuantityStageAction, persistQuantityStageAction, validateQuantityStageParent } from './central-stages'
import { parseQuantityTemplateAction, persistQuantityTemplateAction, validateQuantityTemplateParent } from './central-template-action'
import { quantityTransaction } from './central-transaction'
import { loadQuantityCentralWorkspace } from './central-workspace'
import { loadQuantityCompletionWorkspace } from './completion'
import { parseQuantityImportAction, resolveQuantityImportAssignee } from './import-contract'
import { loadQuantityRegionWorkspace, persistQuantityBuilding, persistQuantityFloor, persistQuantityUnit } from './region'
import { loadQuantityTemplateWorkspace } from './template'
import { loadQuantityVarianceFacts } from './variance'

interface QuantityCurrentProject {
  id: string
  name: string
  code: string
}

interface Options {
  workspaceId: string
  database: QuantityDatabase
  project: (id: string, context: QuantityContext) => Promise<QuantityCurrentProject | null>
  projects?: (context: QuantityContext) => Promise<readonly QuantityCurrentProject[]>
  people?: QuantityPeopleSource
  boq?: QuantityBoqSource
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw quantityProblem('validation-failed', `${label}不能为空`)
  return value.trim()
}

function regionAction(action: QuantityRegionAction): QuantityRegionAction {
  if (!action || !['create-building', 'create-floor', 'create-unit'].includes(action.kind))
    throw quantityProblem('validation-failed', '不支持的工程量命令动作')
  const draft = { code: text(action.draft?.code, '编码'), name: text(action.draft?.name, '显示名称') }
  if (action.kind === 'create-floor')
    return { kind: action.kind, buildingId: text(action.buildingId, '楼栋'), draft }
  if (action.kind === 'create-unit')
    return { kind: action.kind, floorId: text(action.floorId, '楼层'), draft: { ...draft, templateId: text(action.draft?.templateId, '户型模板') } }
  return { kind: action.kind, draft }
}

async function validateRegionParent(db: TransactionDb, projectId: string, action: QuantityRegionAction) {
  const workspace = await loadQuantityRegionWorkspace(db, projectId)
  if (workspace.matrixArchivedAt)
    throw quantityProblem('validation-failed', '工程量矩阵已归档，不能调整项目区域')
  if (action.kind === 'create-floor' && !workspace.buildings.some(row => row.id === action.buildingId))
    throw quantityProblem('validation-failed', '所选楼栋不属于当前项目')
  if (action.kind === 'create-unit') {
    if (!workspace.floors.some(row => row.id === action.floorId))
      throw quantityProblem('validation-failed', '所选楼层不属于当前项目')
    if (!workspace.templates.some(row => row.id === action.draft.templateId))
      throw quantityProblem('validation-failed', '所选户型模板不属于当前项目')
  }
}

function persistRegion(db: TransactionDb, projectId: string, action: QuantityRegionAction) {
  if (action.kind === 'create-floor')
    return persistQuantityFloor(db, projectId, action.buildingId, action.draft)
  if (action.kind === 'create-unit')
    return persistQuantityUnit(db, projectId, action.floorId, action.draft)
  return persistQuantityBuilding(db, projectId, action.draft)
}

/** 服务实例属于一个中央工作区；所有读取、版本和命令共用同一串行事务边界。 */
export function createQuantityService(options: Options) {
  const revisions = new Map<string, number>()
  const commands = new Map<string, { projectId: string, fingerprint: string, result: QuantityCommandResult }>()
  let queue: Promise<void> = Promise.resolve()

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = queue.then(work, work)
    queue = pending.then(() => undefined, () => undefined)
    return pending
  }

  function version(projectId: string): string {
    return `quantity:${projectId}:${revisions.get(projectId) ?? 0}`
  }

  async function authorize(projectId: string, origin: string, context: QuantityContext, write: boolean) {
    if (!context.workspaceId || context.workspaceId !== options.workspaceId || !context.actorId || !context.capabilities.includes(QUANTITY_READ_CAPABILITY)
      || !context.capabilities.includes('project:list:read') || (write && !context.capabilities.includes(QUANTITY_WRITE_CAPABILITY))) {
      throw quantityProblem('forbidden', '当前身份无权访问或修改工程量')
    }
    if (origin !== 'real')
      throw quantityProblem('forbidden', '该正式工程量服务不接受其他数据来源')
    if (!projectId.trim())
      throw quantityProblem('invalid-query', '请选择项目')
    const project = await options.project(projectId, context)
    if (!project)
      throw quantityProblem('not-found', '项目不存在或已删除')
    if (project.id !== projectId)
      throw quantityProblem('relationship-mismatch', '中央项目身份与请求不一致')
    return project
  }

  async function projectMirror(db: TransactionDb, project: QuantityCurrentProject) {
    await db.execute(
      `INSERT INTO projects (id, name, code) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code, deleted_at = NULL`,
      [project.id, project.name, project.code],
    )
  }

  function read<T>(query: QuantityReadQuery, context: QuantityContext, load: (db: TransactionDb, projectId: string) => Promise<T>, needsPeople = false): Promise<QuantityReadResult<T>> {
    const scope = { ...query }
    return serial(async () => {
      const project = await authorize(scope.projectId, scope.origin, context, false)
      const data = await quantityTransaction(options.database, async (db) => {
        await projectMirror(db, project)
        if (needsPeople)
          await synchronizeQuantityPeople(db, context, options.people)
        return load(db, project.id)
      })
      return { data, dataOrigin: 'real', sourceVersion: version(project.id), asOf: new Date().toISOString(), capabilities: [...context.capabilities] }
    })
  }

  async function currentBoq(projectId: string, context: QuantityContext) {
    if (!context.capabilities.includes('construction-contract:read') || !context.capabilities.includes('owner-document:read'))
      throw quantityProblem('forbidden', '当前身份无权读取施工合同清单与已批变更')
    if (!options.boq)
      throw quantityProblem('unavailable', '当前施工合同清单来源尚未接通')
    const source = await options.boq(projectId, context)
    if (source.projectId !== projectId)
      throw quantityProblem('relationship-mismatch', '施工合同清单不属于当前项目')
    return source
  }

  return {
    /** 保持工程量命令串行边界，供月报在当前事实读取后同步固化快照。 */
    withMonthly<T>(query: QuantityMonthlyReadQuery, context: QuantityContext, consume: (facts: readonly QuantityMonthlyBoqFact[]) => T): Promise<T> {
      const scope = { ...query }
      return serial(async () => {
        const project = await authorize(scope.projectId, scope.origin, context, false)
        const source = await currentBoq(project.id, context)
        const facts = await quantityTransaction(options.database, async (db) => {
          await projectMirror(db, project)
          return loadQuantityMonthlyBoqFacts(db, project.id, source.lines, `${version(project.id)}+${source.sourceVersion}:${scope.basis ?? 'field'}`, scope.basis)
        })
        if ((await currentBoq(project.id, context)).sourceVersion !== source.sourceVersion)
          throw quantityProblem('stale-source', '施工合同清单已变化，请重新读取月度工程量')
        return consume(facts)
      })
    },
    variance(query: QuantityReadQuery, context: QuantityContext) {
      const scope = { ...query }
      return read(scope, context, async (db, projectId) => {
        const source = await currentBoq(projectId, context)
        return { projectId, facts: await loadQuantityVarianceFacts(db, projectId, source.lines), boqSourceVersion: source.sourceVersion }
      })
    },
    boq(query: QuantityReadQuery, context: QuantityContext): Promise<QuantityReadResult<QuantityBoqWorkspace>> {
      const scope = { ...query }
      return serial(async () => {
        await authorize(scope.projectId, scope.origin, context, false)
        const { sourceVersion, ...data } = await currentBoq(scope.projectId, context)
        return { data, sourceVersion, dataOrigin: 'real', asOf: new Date().toISOString(), capabilities: [...context.capabilities] }
      })
    },
    /** 由实例独占队列中的迁移提交调用；已入队命令继续以新版本重新验证。 */
    invalidateProjects(projectIds: readonly string[]) {
      const affected = new Set(projectIds)
      for (const projectId of affected)
        revisions.set(projectId, (revisions.get(projectId) ?? 0) + 1)
      for (const [commandId, command] of commands) {
        if (affected.has(command.projectId))
          commands.delete(commandId)
      }
    },
    stages(query: QuantityReadQuery, context: QuantityContext) {
      return read(query, context, loadQuantityStageWorkspace)
    },
    assignments(query: QuantityReadQuery, context: QuantityContext) {
      return read(query, context, loadQuantityAssignmentWorkspace, true)
    },
    workspace(query: QuantityReadQuery, context: QuantityContext) {
      return read(query, context, loadQuantityCentralWorkspace, true)
    },
    completion(query: QuantityUnitReadQuery, context: QuantityContext) {
      const unitId = query.unitId
      return read(query, context, (db, projectId) => loadQuantityCompletionWorkspace(db, projectId, unitId), true)
    },
    batchPlan(query: QuantityBatchReadQuery, context: QuantityContext) {
      const scope = structuredClone(query)
      return read(scope, context, (db, projectId) => loadQuantityBatchCompletionPlan(db, projectId, scope), true)
    },
    photo(query: QuantityReadQuery & QuantityPhotoIdentity, context: QuantityContext) {
      const scope = { ...query }
      return read(scope, context, db => readQuantityCentralPhoto(db, scope))
    },
    templates(query: QuantityReadQuery, context: QuantityContext): Promise<QuantityReadResult<QuantityTemplateWorkspace>> {
      return read(query, context, loadQuantityTemplateWorkspace)
    },
    region(query: QuantityReadQuery, context: QuantityContext): Promise<QuantityReadResult<QuantityRegionWorkspace>> {
      return read(query, context, loadQuantityRegionWorkspace)
    },
    execute(input: QuantityCommand, context: QuantityContext): Promise<QuantityCommandResult> {
      const command = structuredClone(input)
      return serial(async () => {
        if (command.workspaceId !== context.workspaceId || command.actorId !== context.actorId
          || command.requiredCapability !== QUANTITY_WRITE_CAPABILITY) {
          throw quantityProblem('forbidden', '工程量命令身份与当前会话不一致')
        }
        const project = await authorize(command.projectId, command.origin, context, true)
        const templateAction = parseQuantityTemplateAction(command.action)
        const assignmentAction = parseQuantityAssignmentAction(command.action)
        const completionAction = parseQuantityCompletionAction(command.action)
        const stageAction = parseQuantityStageAction(command.action)
        const archiveAction = parseQuantityArchiveAction(command.action)
        const importAction = parseQuantityImportAction(command.action)
        if (importAction) {
          if (!options.projects)
            throw quantityProblem('unavailable', '工程量导入的中央项目目录尚未接通')
          const matches = (await options.projects(context)).filter(row => row.code === importAction.row.projectCode)
          if (matches.length > 1)
            throw quantityProblem('validation-failed', '导入项目编码不唯一，请先核对中央项目目录')
          if (matches.length !== 1 || matches[0]!.id !== project.id || project.code !== importAction.row.projectCode)
            throw quantityProblem('relationship-mismatch', '导入行项目编码与当前中央项目身份不一致')
        }
        const areaAction = templateAction || assignmentAction || completionAction || stageAction || archiveAction || importAction ? null : regionAction(command.action as QuantityRegionAction)
        const action = templateAction ?? assignmentAction ?? completionAction ?? stageAction ?? archiveAction ?? importAction ?? areaAction!
        text(command.commandId, '工程量命令唯一标识')
        const fingerprint = JSON.stringify([command.workspaceId, command.actorId, command.projectId, command.origin, command.baseVersion, action])
        const outcome = await quantityTransaction(options.database, async (db) => {
          await projectMirror(db, project)
          if (importAction) {
            if (importAction.target !== 'template') {
              const source = options.people
              await synchronizeQuantityPeople(db, context, source && (async (scope) => {
                const rows = await source(scope)
                if (importAction.target === 'assignment')
                  resolveQuantityImportAssignee(rows.filter(row => row.dataOrigin === 'real'), importAction.row)
                return rows
              }))
            }
            await validateQuantityImportParent(db, project.id, importAction)
          }
          else if (stageAction) {
            await validateQuantityStageParent(db, project.id, stageAction)
          }
          else if (completionAction) {
            await synchronizeQuantityPeople(db, context, options.people)
            await validateQuantityCompletionParent(db, project.id, completionAction)
          }
          else if (assignmentAction) {
            await synchronizeQuantityPeople(db, context, options.people)
            await validateQuantityAssignmentParent(db, project.id, assignmentAction)
          }
          else if (templateAction) {
            await validateQuantityTemplateParent(db, project.id, templateAction)
          }
          else if (areaAction) {
            await validateRegionParent(db, project.id, areaAction!)
          }
          const cached = commands.get(command.commandId)
          if (cached) {
            if (cached.fingerprint !== fingerprint)
              throw quantityProblem('conflict', '相同命令标识已用于不同内容')
            return { kind: 'cached' as const, result: cached.result }
          }
          if (command.baseVersion !== version(command.projectId))
            throw quantityProblem('stale-source', '工程量已发生变化，请重新读取后核对再保存')
          const [before] = await db.select<{ sequence: number }>('SELECT COALESCE(MAX(rowid), 0) AS sequence FROM operation_logs')
          const boqSource = templateAction?.kind === 'save-template' && templateAction.draft.lines.some(line => typeof line.boqLineId === 'string')
            ? await currentBoq(project.id, context)
            : undefined
          if (boqSource) {
            const selected = new Set(templateAction?.kind === 'save-template' ? templateAction.draft.lines.map(line => line.boqLineId) : [])
            for (const line of boqSource.lines.filter(line => selected.has(line.id))) {
              const [existing] = await db.select<{ project_id: string, contract_id: string }>('SELECT project_id, contract_id FROM quantity_boq_references WHERE id = ?', [line.id])
              if (existing && (existing.project_id !== project.id || existing.contract_id !== line.contractId))
                throw quantityProblem('relationship-mismatch', '清单身份已关联其他项目或施工合同')
              await db.execute('INSERT INTO quantity_boq_references (id, project_id, contract_id) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING', [line.id, project.id, line.contractId])
            }
          }
          const saved: Omit<QuantityCommandResult, 'commandId' | 'sourceVersion'> = importAction
            ? await persistQuantityImport(db, project.id, importAction, context.actorId)
            : archiveAction
              ? await persistQuantityArchive(db, project.id, archiveAction)
              : stageAction
                ? await persistQuantityStageAction(db, project.id, stageAction)
                : completionAction
                  ? await persistQuantityCompletionAction(db, completionAction, context.actorId)
                  : assignmentAction
                    ? await persistQuantityAssignmentAction(db, assignmentAction)
                    : templateAction
                      ? await persistQuantityTemplateAction(db, project.id, templateAction, boqSource?.lines)
                      : { id: await persistRegion(db, project.id, areaAction!), logIds: [] }
          if (boqSource && (await currentBoq(project.id, context)).sourceVersion !== boqSource.sourceVersion)
            throw quantityProblem('stale-source', '施工合同清单已变化，请重新核对关联后保存')
          await db.execute('UPDATE operation_logs SET operator = ? WHERE rowid > ?', [context.actorId, before?.sequence ?? 0])
          return { kind: 'saved' as const, ...saved }
        })
        if (outcome.kind === 'cached')
          return structuredClone(outcome.result)
        revisions.set(project.id, (revisions.get(project.id) ?? 0) + 1)
        const { kind: _kind, ...saved } = outcome
        const result: QuantityCommandResult = { ...saved, commandId: command.commandId, sourceVersion: version(project.id) }
        commands.set(command.commandId, { projectId: project.id, fingerprint, result })
        return structuredClone(result)
      })
    },
  }
}
