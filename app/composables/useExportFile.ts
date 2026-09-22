import type { OpenExportWorkflowTabResult } from '~/composables/useExportWorkflowTab'
import type { ExportFileOptions, ExportFileResult } from '~/lib/kit/export'
import type { ExportWorkflowOptions } from '~/stores/export-workflows'
import { chooseExportPath, exportFile as runExportFile } from '~/lib/kit/export'
import { pickExportDirectory } from '~/lib/platform/export-directory'
import { toErrorMessage } from '~/lib/util/error'

export type KitExportOptions
  = | (ExportFileOptions & { requiresDirectoryStructure?: false })
    | (ExportWorkflowOptions & { requiresDirectoryStructure: true })

export type KitExportResult = ExportFileResult | OpenExportWorkflowTabResult

export interface KitExport {
  (options: ExportFileOptions & { requiresDirectoryStructure?: false }): Promise<ExportFileResult>
  (options: ExportWorkflowOptions & { requiresDirectoryStructure: true }): Promise<OpenExportWorkflowTabResult>
}

export function useExportFile(
  openExportTab = useExportWorkflowTab(),
): KitExport {
  const toast = useToast()

  const exportFile = async (options: KitExportOptions): Promise<KitExportResult> => {
    // chooseExportPath 是 ADR 0004 的唯一分流键；这里按其结论收窄联合类型。
    if (chooseExportPath({
      requiresDirectoryStructure: options.requiresDirectoryStructure === true,
    }) === 'config-tab') {
      const { requiresDirectoryStructure: _, ...workflow }
        = options as ExportWorkflowOptions & { requiresDirectoryStructure: true }
      return await openExportTab(workflow)
    }

    const fileOptions = options as ExportFileOptions
    return await runExportFile(fileOptions, {
      pickDirectory: pickExportDirectory,
      feedback: {
        async during(task) {
          const id = toast.loading(typeof fileOptions.data === 'function' ? '正在准备并保存文件…' : '正在写入导出文件…')
          try {
            const result = await task()
            toast.dismiss(id)
            return result
          }
          catch (error) {
            toast.update(id, {
              type: 'error',
              message: '导出失败',
              description: toErrorMessage(error),
            })
            throw error
          }
        },
        success: message => toast.success(message),
        failure: error => toast.processError('导出失败', toErrorMessage(error)),
      },
    })
  }

  return exportFile as KitExport
}
