import type { QuantityAssignmentBatchDraft, QuantityAssignmentWorkspace } from '~/lib/quantity/assignment'
import type { QuantityBatchCompletionDraft } from '~/lib/quantity/batch-completion'
import type { QuantityCompletionDraft, QuantityCompletionWorkspace } from '~/lib/quantity/completion'
import type { QuantityStageProgress } from '~/lib/quantity/derived'
import type { QuantityCatalogProject, QuantityProjectSnapshot } from '~/lib/quantity/read-model'
import type { QuantityTemplateDraft, QuantityTemplateWorkspace } from '~/lib/quantity/template'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { withTransaction } from '~/lib/db/connection'
import { withUpdateLog } from '~/lib/db/soft-delete'
import { loadQuantityAssignmentWorkspace, persistQuantityAssignments } from '~/lib/quantity/assignment'
import { persistQuantityBatchCompletion } from '~/lib/quantity/batch-completion'
import { loadQuantityCompletionWorkspace, persistQuantityStageCompletion } from '~/lib/quantity/completion'
import { loadQuantityStageProgress } from '~/lib/quantity/derived'
import { loadQuantityCatalog, loadQuantityProjectSnapshot } from '~/lib/quantity/read-model'
import {
  deleteQuantityTemplate,
  loadQuantityTemplateWorkspace,
  persistQuantityTemplate,
  snapshotQuantityTemplateDraft,
  undoQuantityTemplateOperations,
} from '~/lib/quantity/template'
import { toErrorMessage } from '~/lib/util/error'

export const useQuantityStore = defineStore('quantity', () => {
  const catalog = shallowRef<QuantityCatalogProject[]>([])
  const snapshot = shallowRef<QuantityProjectSnapshot | null>(null)
  const stageProgress = shallowRef<QuantityStageProgress[]>([])
  const loading = shallowRef(false)
  const error = shallowRef('')
  const templateWorkspace = shallowRef<QuantityTemplateWorkspace | null>(null)
  const templateLoading = shallowRef(false)
  const templateSaving = shallowRef(false)
  const templateError = shallowRef('')
  const assignmentWorkspace = shallowRef<QuantityAssignmentWorkspace | null>(null)
  const assignmentLoading = shallowRef(false)
  const assignmentSaving = shallowRef(false)
  const assignmentError = shallowRef('')
  const completionWorkspace = shallowRef<QuantityCompletionWorkspace | null>(null)
  const completionLoading = shallowRef(false)
  const completionSaving = shallowRef(false)
  const completionError = shallowRef('')
  let pending = 0
  let latestProjectRequest = 0
  let pendingTemplateRequests = 0
  let latestTemplateRequest = 0
  let pendingAssignmentRequests = 0
  let latestAssignmentRequest = 0
  let pendingCompletionRequests = 0
  let latestCompletionRequest = 0

  function beginRequest() {
    pending += 1
    loading.value = true
    error.value = ''
  }

  function endRequest() {
    pending = Math.max(0, pending - 1)
    loading.value = pending > 0
  }

  async function loadCatalog() {
    beginRequest()
    try {
      catalog.value = await loadQuantityCatalog(db)
    }
    catch (cause) {
      catalog.value = []
      error.value = `工程量项目加载失败：${toErrorMessage(cause)}`
    }
    finally {
      endRequest()
    }
  }

  async function loadProject(projectId: string) {
    const request = ++latestProjectRequest
    if (!projectId) {
      snapshot.value = null
      stageProgress.value = []
      return
    }
    if (snapshot.value?.projectId !== projectId) {
      snapshot.value = null
      stageProgress.value = []
    }
    beginRequest()
    try {
      const [result, progress] = await Promise.all([
        loadQuantityProjectSnapshot(db, projectId),
        loadQuantityStageProgress(db, projectId),
      ])
      if (request === latestProjectRequest) {
        snapshot.value = result
        stageProgress.value = progress
      }
    }
    catch (cause) {
      if (request === latestProjectRequest) {
        snapshot.value = null
        stageProgress.value = []
        error.value = `工程量矩阵加载失败：${toErrorMessage(cause)}`
      }
    }
    finally {
      endRequest()
    }
  }

  async function loadTemplates(projectId: string) {
    const request = ++latestTemplateRequest
    pendingTemplateRequests += 1
    templateLoading.value = true
    templateError.value = ''
    if (templateWorkspace.value?.projectId !== projectId)
      templateWorkspace.value = null
    try {
      const result = projectId
        ? await loadQuantityTemplateWorkspace(db, projectId)
        : null
      if (request === latestTemplateRequest)
        templateWorkspace.value = result
    }
    catch (cause) {
      if (request === latestTemplateRequest) {
        templateWorkspace.value = null
        templateError.value = `户型模板加载失败：${toErrorMessage(cause)}`
        throw cause
      }
    }
    finally {
      pendingTemplateRequests = Math.max(0, pendingTemplateRequests - 1)
      templateLoading.value = pendingTemplateRequests > 0
    }
  }

  async function saveTemplate(draft: QuantityTemplateDraft) {
    const savedDraft = snapshotQuantityTemplateDraft(draft)
    templateSaving.value = true
    templateError.value = ''
    try {
      const result = await withTransaction(tx => persistQuantityTemplate(tx, savedDraft))
      try {
        await loadTemplates(savedDraft.projectId)
      }
      catch (cause) {
        templateError.value = `户型模板已保存，但刷新失败：${toErrorMessage(cause)}；请重新打开模板编辑器加载最新数据。`
      }
      return result
    }
    catch (cause) {
      templateError.value = `户型模板保存失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      templateSaving.value = false
    }
  }

  async function deleteTemplate(templateId: string, options: { allowArchivedEdit?: boolean } = {}) {
    const projectId = templateWorkspace.value?.projectId ?? ''
    if (!projectId)
      throw new Error('请先加载户型模板')
    templateSaving.value = true
    templateError.value = ''
    try {
      const logId = await withTransaction(tx => deleteQuantityTemplate(tx, projectId, templateId, options))
      try {
        await loadTemplates(projectId)
      }
      catch (cause) {
        templateError.value = `户型模板已删除，但刷新失败：${toErrorMessage(cause)}；请重新打开模板编辑器加载最新数据。`
      }
      return logId
    }
    catch (cause) {
      templateError.value = `户型模板删除失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      templateSaving.value = false
    }
  }

  async function undoTemplateSave(projectId: string, logIds: readonly string[], reloadProject = true) {
    templateSaving.value = true
    templateError.value = ''
    try {
      await withTransaction(tx => undoQuantityTemplateOperations(tx, projectId, logIds))
      if (reloadProject) {
        try {
          await loadTemplates(projectId)
        }
        catch (cause) {
          templateError.value = `户型模板已撤回，但刷新失败：${toErrorMessage(cause)}；请重新打开模板编辑器加载最新数据。`
        }
      }
    }
    catch (cause) {
      templateError.value = `户型模板撤回失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      templateSaving.value = false
    }
  }

  async function loadAssignments(projectId: string) {
    const request = ++latestAssignmentRequest
    pendingAssignmentRequests += 1
    assignmentLoading.value = true
    assignmentError.value = ''
    if (assignmentWorkspace.value?.projectId !== projectId)
      assignmentWorkspace.value = null
    try {
      const result = projectId
        ? await loadQuantityAssignmentWorkspace(db, projectId)
        : null
      if (request === latestAssignmentRequest)
        assignmentWorkspace.value = result
    }
    catch (cause) {
      if (request === latestAssignmentRequest) {
        assignmentWorkspace.value = null
        assignmentError.value = `责任配置加载失败：${toErrorMessage(cause)}`
      }
      throw cause
    }
    finally {
      pendingAssignmentRequests = Math.max(0, pendingAssignmentRequests - 1)
      assignmentLoading.value = pendingAssignmentRequests > 0
    }
  }

  async function loadCompletion(projectId: string, unitId: string) {
    const request = ++latestCompletionRequest
    pendingCompletionRequests += 1
    completionLoading.value = true
    completionError.value = ''
    if (completionWorkspace.value?.projectId !== projectId || completionWorkspace.value?.unit.id !== unitId)
      completionWorkspace.value = null
    try {
      const result = projectId && unitId
        ? await loadQuantityCompletionWorkspace(db, projectId, unitId)
        : null
      if (request === latestCompletionRequest)
        completionWorkspace.value = result
    }
    catch (cause) {
      if (request === latestCompletionRequest) {
        completionWorkspace.value = null
        completionError.value = `完成登记加载失败：${toErrorMessage(cause)}`
      }
      throw cause
    }
    finally {
      pendingCompletionRequests = Math.max(0, pendingCompletionRequests - 1)
      completionLoading.value = pendingCompletionRequests > 0
    }
  }

  async function saveCompletion(draft: QuantityCompletionDraft) {
    completionSaving.value = true
    completionError.value = ''
    try {
      const result = await withTransaction(tx => persistQuantityStageCompletion(tx, draft))
      try {
        await loadCompletion(draft.projectId, draft.unitId)
        await loadProject(draft.projectId)
        if (snapshot.value?.projectId !== draft.projectId || error.value)
          throw new Error(error.value || '工程量矩阵未能刷新')
      }
      catch (cause) {
        completionError.value = `完成登记已保存，但刷新失败：${toErrorMessage(cause)}；请刷新工程量页面加载最新数据。`
      }
      return result
    }
    catch (cause) {
      completionError.value = `完成登记保存失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      completionSaving.value = false
    }
  }

  // 归档独立 action：matrix_archived_at 刻意不在 project store 的列登记表里，
  // 普通项目全字段更新不触碰它；归档/解除都单独落 projects update 日志（蓝本§六）。
  async function setMatrixArchived(projectId: string, archived: boolean) {
    if (!projectId)
      throw new Error('请选择项目')
    beginRequest()
    try {
      const logId = await withTransaction(async (tx) => {
        const [row] = await tx.select<{ matrix_archived_at: string | null }>(
          'SELECT matrix_archived_at FROM projects WHERE id = ? AND deleted_at IS NULL',
          [projectId],
        )
        if (!row)
          throw new Error('工程量项目不存在或已删除')
        if ((row.matrix_archived_at != null) === archived)
          return null
        return withUpdateLog(tx, 'projects', projectId, async () => {
          await tx.execute(
            'UPDATE projects SET matrix_archived_at = ? WHERE id = ?',
            [archived ? new Date().toISOString() : null, projectId],
          )
        })
      })
      if (logId)
        await loadProject(projectId)
      return logId
    }
    catch (cause) {
      error.value = `${archived ? '归档' : '解除归档'}失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      endRequest()
    }
  }

  async function archiveMatrix(projectId: string) {
    return setMatrixArchived(projectId, true)
  }

  async function unarchiveMatrix(projectId: string) {
    return setMatrixArchived(projectId, false)
  }

  async function saveBatchCompletion(draft: QuantityBatchCompletionDraft) {
    completionSaving.value = true
    completionError.value = ''
    try {
      const result = await withTransaction(tx => persistQuantityBatchCompletion(tx, draft))
      try {
        await loadProject(draft.projectId)
        if (snapshot.value?.projectId !== draft.projectId || error.value)
          throw new Error(error.value || '工程量矩阵未能刷新')
      }
      catch (cause) {
        completionError.value = `批量完成已保存，但刷新失败：${toErrorMessage(cause)}；请刷新工程量页面加载最新数据。`
      }
      return result
    }
    catch (cause) {
      completionError.value = `批量完成保存失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      completionSaving.value = false
    }
  }

  async function saveAssignments(draft: QuantityAssignmentBatchDraft) {
    assignmentSaving.value = true
    assignmentError.value = ''
    try {
      const result = await withTransaction(tx => persistQuantityAssignments(tx, draft))
      try {
        await loadAssignments(draft.projectId)
        await loadProject(draft.projectId)
        if (snapshot.value?.projectId !== draft.projectId || error.value)
          throw new Error(error.value || '工程量矩阵未能刷新')
      }
      catch (cause) {
        assignmentError.value = `责任配置已保存，但刷新失败：${toErrorMessage(cause)}；请刷新工程量页面加载最新数据。`
      }
      return result
    }
    catch (cause) {
      assignmentError.value = `责任配置保存失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      assignmentSaving.value = false
    }
  }

  return {
    catalog: readonly(catalog),
    snapshot: readonly(snapshot),
    stageProgress: readonly(stageProgress),
    loading: readonly(loading),
    error: readonly(error),
    templateWorkspace: readonly(templateWorkspace),
    templateLoading: readonly(templateLoading),
    templateSaving: readonly(templateSaving),
    templateError: readonly(templateError),
    assignmentWorkspace: readonly(assignmentWorkspace),
    assignmentLoading: readonly(assignmentLoading),
    assignmentSaving: readonly(assignmentSaving),
    assignmentError: readonly(assignmentError),
    completionWorkspace: readonly(completionWorkspace),
    completionLoading: readonly(completionLoading),
    completionSaving: readonly(completionSaving),
    completionError: readonly(completionError),
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
    saveBatchCompletion,
    archiveMatrix,
    unarchiveMatrix,
  }
})
