import type { FileRefDraft } from '~/lib/forms/file-refs'
import type { ProjectSupplierImportContextDTO, ProjectSupplierImportResult } from '~/lib/project-supplier/repository'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { PROJECT_SUPPLIER_WRITE_CAPABILITY, projectSupplierProblemFromUnknown } from '~/lib/project-supplier/repository'

export interface ProjectSupplierImportGroup {
  supplierId?: string
  supplierName: string
  files: readonly FileRefDraft[]
}

export const useProjectSupplierCommandStore = defineStore('project-supplier-command', () => {
  const context = shallowRef<ProjectSupplierImportContextDTO | null>(null)
  const latestWrite = shallowRef<{ projectId: string, version: string } | null>(null)
  let pendingCommand: { id: string, fingerprint: string } | null = null
  const repository = () => useNuxtApp().$repositories.projectSupplierCommands

  async function hydrate(projectId: string) {
    const loaded = await repository().loadImportContext(projectId)
    if (!loaded.capabilities.includes(PROJECT_SUPPLIER_WRITE_CAPABILITY))
      throw projectSupplierProblemFromUnknown(new Error('无项目分供方导入权限'))
    context.value = loaded
    pendingCommand = null
    return loaded
  }

  async function importFiles(projectId: string, groups: readonly ProjectSupplierImportGroup[]): Promise<ProjectSupplierImportResult> {
    const current = context.value?.project.id === projectId ? context.value : await hydrate(projectId)
    const bodyGroups = groups.map(group => ({
      supplierId: group.supplierId?.trim() || null,
      supplierName: group.supplierName.trim(),
      files: group.files.map(file => ({
        fileName: file.fileName,
        fileSize: Math.max(Number(file.fileSize) || 0, 0),
        mimeType: file.mimeType?.trim() ?? '',
        category: file.category?.trim() ?? '',
        payloadBase64: file.payloadBase64 ?? '',
      })),
    }))
    const fingerprint = JSON.stringify({ projectId, baseVersion: current.sourceVersion, groups: bodyGroups })
    if (!pendingCommand || pendingCommand.fingerprint !== fingerprint)
      pendingCommand = { id: crypto.randomUUID(), fingerprint }
    try {
      const result = await repository().importFiles({
        projectId,
        workspaceId: current.workspaceId,
        actorId: current.actorId,
        requiredCapability: PROJECT_SUPPLIER_WRITE_CAPABILITY,
        commandId: pendingCommand.id,
        baseVersion: current.sourceVersion,
        groups: bodyGroups,
      })
      pendingCommand = null
      latestWrite.value = { projectId, version: result.version }
      context.value = { ...current, sourceVersion: result.version }
      return {
        relationshipCount: result.relationshipCount,
        fileCount: result.fileCount,
        createdSupplierCount: result.createdSupplierCount,
        reusedRelationshipCount: result.reusedRelationshipCount,
      }
    }
    catch (cause) {
      throw projectSupplierProblemFromUnknown(cause)
    }
  }

  return { context: readonly(context), latestWrite: readonly(latestWrite), hydrate, importFiles }
})
