import type { ExportFileOptions, ExportFileResult } from '~/lib/kit/export'
import { exportFile as runExportFile } from '~/lib/kit/export'
import { pickExportDirectory } from '~/lib/platform/export-directory'

function errorDescription(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useExportFile() {
  const toast = useToast()

  return async (options: ExportFileOptions): Promise<ExportFileResult> => {
    return await runExportFile(options, {
      pickDirectory: pickExportDirectory,
      feedback: {
        async during(task) {
          const id = toast.loading('正在写入导出文件…')
          try {
            const result = await task()
            toast.dismiss(id)
            return result
          }
          catch (error) {
            toast.update(id, {
              type: 'error',
              message: '导出失败',
              description: errorDescription(error),
            })
            throw error
          }
        },
        success: message => toast.success(message),
        failure: error => toast.processError('导出失败', errorDescription(error)),
      },
    })
  }
}
