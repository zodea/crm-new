import type { DataOriginDTO } from '../../types/read-model'
import type { QuantityAssignmentBatchDraft } from './assignment'
import type { QuantityBatchCompletionDraft } from './batch-completion'
import type { QuantityProjectChoice } from './browser-catalog'
import type { QuantityCommand, QuantityCommandResult, QuantityContext, QuantityReadQuery } from './central-contract'
import type { QuantityPhotoIdentity } from './central-photo'
import type { QuantityCompletionDraft } from './completion'
import type { QuantityReadAdapter } from './read-adapter'
import type { QuantityRegionNodeDraft, QuantityRegionUnitDraft } from './region'
import type { QuantityTemplateDraft } from './template'
import { computed, readonly, shallowRef } from 'vue'
import { toErrorMessage } from '../util/error'
import { quantityProblem } from './central-contract'
import { snapshotQuantityTemplateDraft } from './template'
import { createQuantityWorkspaceState } from './workspace-state'

export function createQuantityBrowserState(dependencies: {
  reads: QuantityReadAdapter
  context: () => Promise<QuantityContext>
  execute: (command: QuantityCommand) => Promise<QuantityCommandResult>
  catalog: () => Promise<QuantityProjectChoice[]>
  includeDemo: () => boolean
}) {
  const common = { context: dependencies.context, execute: dependencies.execute }
  const matrix = createQuantityWorkspaceState({ ...common, read: dependencies.reads.workspace })
  const templates = createQuantityWorkspaceState({ ...common, read: dependencies.reads.templates })
  const region = createQuantityWorkspaceState({ ...common, read: dependencies.reads.region })
  const assignments = createQuantityWorkspaceState({ ...common, read: dependencies.reads.assignments })
  const completion = createQuantityWorkspaceState({ ...common, read: dependencies.reads.completion })
  const batch = createQuantityWorkspaceState({ ...common, read: dependencies.reads.batchPlan })
  const catalog = shallowRef<QuantityProjectChoice[]>([])
  const catalogLoading = shallowRef(false)
  const catalogError = shallowRef('')
  const templateNotice = shallowRef('')
  const regionNotice = shallowRef('')
  const assignmentNotice = shallowRef('')
  const completionNotice = shallowRef('')
  let catalogGeneration = 0
  const query = (projectId: string, origin: DataOriginDTO = 'real'): QuantityReadQuery => ({ projectId, origin, includeDemo: dependencies.includeDemo() })
  const error = computed(() => catalogError.value || matrix.problem.value?.message || '')
  const snapshot = computed(() => matrix.workspace.value?.snapshot ?? null)
  const stageProgress = computed(() => matrix.workspace.value?.stageProgress ?? [])
  const dataOrigin = computed(() => matrix.scope.value?.origin ?? 'real')

  async function loadCatalog() {
    const current = ++catalogGeneration
    catalogLoading.value = true
    catalogError.value = ''
    catalog.value = []
    try {
      const result = await dependencies.catalog()
      if (current === catalogGeneration)
        catalog.value = result
    }
    catch (cause) {
      if (current === catalogGeneration)
        catalogError.value = `工程量项目加载失败：${toErrorMessage(cause)}`
    }
    finally {
      if (current === catalogGeneration)
        catalogLoading.value = false
    }
  }

  async function loadProject(projectId: string, origin: DataOriginDTO = 'real') {
    try {
      await matrix.load(query(projectId, origin))
    }
    catch {
      // 列表通过显式 problem 展示失败，旧事实在读取开始时已撤销。
    }
  }

  function loadTemplates(projectId: string, origin: DataOriginDTO = 'real') {
    templateNotice.value = ''
    return templates.load(query(projectId, origin))
  }
  function loadRegion(projectId: string, origin: DataOriginDTO = 'real') {
    regionNotice.value = ''
    return region.load(query(projectId, origin))
  }
  function loadAssignments(projectId: string, origin: DataOriginDTO = 'real') {
    assignmentNotice.value = ''
    return assignments.load(query(projectId, origin))
  }
  function loadCompletion(projectId: string, unitId: string, origin: DataOriginDTO = 'real') {
    completionNotice.value = ''
    return completion.load({ ...query(projectId, origin), unitId })
  }
  function loadBatchPlan(projectId: string, trade: string, unitIds: readonly string[], origin: DataOriginDTO = 'real') {
    completionNotice.value = ''
    return batch.load({ ...query(projectId, origin), trade, unitIds: [...unitIds] })
  }

  function requireResult(result: QuantityCommandResult | null): QuantityCommandResult {
    if (!result)
      throw quantityProblem('unavailable', '页面已切换，请重新读取当前工程量确认结果')
    return result
  }
  function requireProject(scope: { projectId: string } | null, projectId: string) {
    if (!scope || scope.projectId !== projectId)
      throw quantityProblem('relationship-mismatch', '请先读取当前项目对应的编辑工作面')
  }
  async function reloadMatrix(projectId: string, origin: DataOriginDTO) {
    if (matrix.scope.value?.projectId === projectId && matrix.scope.value.origin === origin)
      await matrix.load(query(projectId, origin))
  }
  async function saveTemplate(draft: QuantityTemplateDraft) {
    requireProject(templates.scope.value, draft.projectId)
    templateNotice.value = ''
    const result = requireResult(await templates.execute({ kind: 'save-template', draft: snapshotQuantityTemplateDraft(draft) }))
    try {
      await templates.load({ ...templates.scope.value! })
    }
    catch (cause) {
      templateNotice.value = `户型模板已保存，但刷新失败：${toErrorMessage(cause)}`
    }
    return { templateId: result.id, logIds: result.logIds }
  }
  async function deleteTemplate(templateId: string, options: { allowArchivedEdit?: boolean } = {}) {
    const result = requireResult(await templates.execute({ kind: 'delete-template', templateId, allowArchivedEdit: options.allowArchivedEdit === true }))
    try {
      await templates.load({ ...templates.scope.value! })
    }
    catch (cause) { templateNotice.value = `户型模板已删除，但刷新失败：${toErrorMessage(cause)}` }
    return result.logIds[0] ?? ''
  }
  async function undoTemplateSave(projectId: string, logIds: readonly string[], reloadProject = true, options: { allowArchivedEdit?: boolean } = {}) {
    requireProject(templates.scope.value, projectId)
    requireResult(await templates.execute({ kind: 'undo-template', logIds: [...logIds], allowArchivedEdit: options.allowArchivedEdit === true }))
    if (reloadProject) {
      try {
        await templates.load({ ...templates.scope.value! })
      }
      catch (cause) { templateNotice.value = `户型模板已撤回，但刷新失败：${toErrorMessage(cause)}` }
    }
  }
  async function saveRegion(projectId: string, action: Extract<QuantityCommand['action'], { kind: 'create-building' | 'create-floor' | 'create-unit' }>) {
    requireProject(region.scope.value, projectId)
    regionNotice.value = ''
    const origin = region.scope.value!.origin
    const result = requireResult(await region.execute(action))
    try {
      await region.load(query(projectId, origin))
      await reloadMatrix(projectId, origin)
    }
    catch (cause) { regionNotice.value = `项目区域已保存，但刷新失败：${toErrorMessage(cause)}` }
    return result.id
  }
  async function saveAssignments(draft: QuantityAssignmentBatchDraft) {
    requireProject(assignments.scope.value, draft.projectId)
    assignmentNotice.value = ''
    const origin = assignments.scope.value!.origin
    const result = requireResult(await assignments.execute({ kind: 'save-assignments', draft }))
    if (!result.assignments)
      throw quantityProblem('internal-error', '责任保存结果不完整，请重新读取确认')
    try {
      await assignments.load(query(draft.projectId, origin))
      await reloadMatrix(draft.projectId, origin)
    }
    catch (cause) { assignmentNotice.value = `责任配置已保存，但刷新失败：${toErrorMessage(cause)}` }
    return result.assignments
  }
  async function saveCompletion(draft: QuantityCompletionDraft) {
    requireProject(completion.scope.value, draft.projectId)
    if (completion.scope.value?.unitId !== draft.unitId)
      throw quantityProblem('relationship-mismatch', '请先读取当前户的完成工作面')
    completionNotice.value = ''
    const origin = completion.scope.value.origin
    const result = requireResult(await completion.execute({ kind: 'save-completion', draft }))
    if (!result.completion)
      throw quantityProblem('internal-error', '完成保存结果不完整，请重新读取确认')
    try {
      await completion.load({ ...query(draft.projectId, origin), unitId: draft.unitId })
      await reloadMatrix(draft.projectId, origin)
    }
    catch (cause) { completionNotice.value = `完成登记已保存，但刷新失败：${toErrorMessage(cause)}` }
    return result.completion
  }
  async function saveBatchCompletion(draft: QuantityBatchCompletionDraft) {
    requireProject(batch.scope.value, draft.projectId)
    completionNotice.value = ''
    const result = requireResult(await batch.execute({ kind: 'save-completion-batch', draft }))
    if (!result.batch)
      throw quantityProblem('internal-error', '批量完成结果不完整，请重新读取确认')
    try {
      await reloadMatrix(draft.projectId, batch.scope.value!.origin)
    }
    catch (cause) { completionNotice.value = `批量完成已保存，但刷新失败：${toErrorMessage(cause)}` }
    return result.batch
  }
  async function setArchived(projectId: string, archived: boolean) {
    requireProject(matrix.scope.value, projectId)
    const result = requireResult(await matrix.execute({ kind: 'set-archived', archived }))
    await loadProject(projectId, matrix.scope.value!.origin)
    return result.logIds[0] ?? null
  }
  function cancelWorkspaces() {
    catalogGeneration++
    catalogLoading.value = false
    for (const state of [matrix, templates, region, assignments, completion, batch])
      state.cancel()
  }
  return {
    catalog: readonly(catalog),
    snapshot,
    stageProgress,
    dataOrigin,
    canWrite: matrix.canWrite,
    canImport: matrix.canWrite,
    loading: computed(() => catalogLoading.value || matrix.loading.value),
    error,
    exportWorkspace: matrix.workspace,
    templateWorkspace: templates.workspace,
    templateOrigin: computed(() => templates.scope.value?.origin ?? null),
    templateLoading: templates.loading,
    templateSaving: templates.saving,
    templateError: computed(() => templateNotice.value || templates.problem.value?.message || ''),
    templateCanWrite: templates.canWrite,
    regionWorkspace: region.workspace,
    regionOrigin: computed(() => region.scope.value?.origin ?? null),
    regionLoading: region.loading,
    regionSaving: region.saving,
    regionError: computed(() => regionNotice.value || region.problem.value?.message || ''),
    regionCanWrite: region.canWrite,
    assignmentWorkspace: assignments.workspace,
    assignmentLoading: assignments.loading,
    assignmentSaving: assignments.saving,
    assignmentError: computed(() => assignmentNotice.value || assignments.problem.value?.message || ''),
    assignmentCanWrite: assignments.canWrite,
    assignmentOrigin: computed(() => assignments.scope.value?.origin ?? null),
    completionWorkspace: completion.workspace,
    completionOrigin: computed(() => completion.scope.value?.origin ?? null),
    completionLoading: completion.loading,
    completionSaving: computed(() => completion.saving.value || batch.saving.value),
    completionError: computed(() => completionNotice.value || completion.problem.value?.message || batch.problem.value?.message || ''),
    completionCanWrite: completion.canWrite,
    batchPlan: batch.workspace,
    batchLoading: batch.loading,
    batchCanWrite: batch.canWrite,
    loadCatalog,
    loadProject,
    loadTemplates,
    saveTemplate,
    deleteTemplate,
    undoTemplateSave,
    loadAssignments,
    saveAssignments,
    loadCompletion,
    saveCompletion,
    loadBatchPlan,
    saveBatchCompletion,
    loadRegion,
    createRegionBuilding: (projectId: string, draft: QuantityRegionNodeDraft) => saveRegion(projectId, { kind: 'create-building', draft: { ...draft } }),
    createRegionFloor: (projectId: string, buildingId: string, draft: QuantityRegionNodeDraft) => saveRegion(projectId, { kind: 'create-floor', buildingId, draft: { ...draft } }),
    createRegionUnit: (projectId: string, floorId: string, draft: QuantityRegionUnitDraft) => saveRegion(projectId, { kind: 'create-unit', floorId, draft: { ...draft } }),
    archiveMatrix: (projectId: string) => setArchived(projectId, true),
    unarchiveMatrix: (projectId: string) => setArchived(projectId, false),
    loadPhoto: async (identity: QuantityPhotoIdentity, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => (await dependencies.reads.photo({ ...query(identity.projectId, origin), ...identity }, options)).data,
    canLinkBoq: computed(() => templates.scope.value?.origin === 'real'),
    loadBoq: (projectId: string, options?: { signal?: AbortSignal }) => dependencies.reads.boq(query(projectId, 'real'), options),
    revalidateTemplate: templates.revalidate,
    revalidateRegion: region.revalidate,
    cancelWorkspaces,
    cancelProject: matrix.cancel,
    cancelTemplate: templates.cancel,
    cancelRegion: region.cancel,
    cancelCompletion: completion.cancel,
    readExportWorkspace: async (projectId: string, origin: DataOriginDTO = 'real') => {
      if (matrix.scope.value?.projectId !== projectId || matrix.scope.value.origin !== origin || !matrix.workspace.value || matrix.problem.value)
        throw quantityProblem('unavailable', '请先成功读取当前来源的工程量矩阵，再导出相同事实')
      await matrix.load(query(projectId, origin))
      if (!matrix.workspace.value || matrix.scope.value?.projectId !== projectId || matrix.scope.value.origin !== origin)
        throw quantityProblem('unavailable', '工程量来源已切换，请从当前矩阵重新导出')
      return matrix.workspace.value
    },
    loadVariance: async (projectId: string, origin: DataOriginDTO = 'real') => (await dependencies.reads.variance(query(projectId, origin))).data.facts,
  }
}
