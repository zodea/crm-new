import type { QuantityCatalogProject, QuantityProjectSnapshot } from '~/lib/quantity/read-model'
import type { QuantityTemplateDraft, QuantityTemplateWorkspace } from '~/lib/quantity/template'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { withTransaction } from '~/lib/db/connection'
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
  const loading = shallowRef(false)
  const error = shallowRef('')
  const templateWorkspace = shallowRef<QuantityTemplateWorkspace | null>(null)
  const templateLoading = shallowRef(false)
  const templateSaving = shallowRef(false)
  const templateError = shallowRef('')
  let pending = 0
  let latestProjectRequest = 0
  let pendingTemplateRequests = 0
  let latestTemplateRequest = 0

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
      return
    }
    if (snapshot.value?.projectId !== projectId)
      snapshot.value = null
    beginRequest()
    try {
      const result = await loadQuantityProjectSnapshot(db, projectId)
      if (request === latestProjectRequest)
        snapshot.value = result
    }
    catch (cause) {
      if (request === latestProjectRequest) {
        snapshot.value = null
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

  async function deleteTemplate(templateId: string) {
    const projectId = templateWorkspace.value?.projectId ?? ''
    if (!projectId)
      throw new Error('请先加载户型模板')
    templateSaving.value = true
    templateError.value = ''
    try {
      const logId = await withTransaction(tx => deleteQuantityTemplate(tx, projectId, templateId))
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

  return {
    catalog: readonly(catalog),
    snapshot: readonly(snapshot),
    loading: readonly(loading),
    error: readonly(error),
    templateWorkspace: readonly(templateWorkspace),
    templateLoading: readonly(templateLoading),
    templateSaving: readonly(templateSaving),
    templateError: readonly(templateError),
    loadCatalog,
    loadProject,
    loadTemplates,
    saveTemplate,
    deleteTemplate,
    undoTemplateSave,
  }
})
