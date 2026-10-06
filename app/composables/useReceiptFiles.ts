import type { FileRefRecord } from '~/lib/forms/file-refs'
import type { ExportFileOptions, ExportFileResult } from '~/lib/kit/export'
import type { ReceiptRecord } from '~/lib/receipt/contract'
import type { ReceiptRepository } from '~/lib/receipt/repository'
import { receiptProblem } from '~/lib/receipt/contract'
import { receiptProblemFromUnknown } from '~/lib/receipt/repository'
import { useOriginalFiles } from './useOriginalFiles'

export function useReceiptFiles(options: {
  record: () => ReceiptRecord | null
  repository: Pick<ReceiptRepository, 'fileContent'>
  exportFile: (options: ExportFileOptions) => Promise<ExportFileResult>
}) {
  function canRead(file: FileRefRecord) {
    const record = options.record()
    return Boolean(record?.dataOrigin === 'real' && record.attachments.some(row => row.id === file.id
      && row.ownerId === record.id && row.ownerType === 'receipt_registration' && row.deletedAt === null))
  }
  return useOriginalFiles({
    scope: () => {
      const record = options.record()
      return record ? `${record.dataOrigin}:${record.id}:${record.version}` : ''
    },
    canRead,
    read: (file, signal) => {
      const record = options.record()
      if (!record || !canRead(file))
        throw receiptProblem('forbidden', '当前来源没有可读取的收款附件正文')
      return options.repository.fileContent(record.id, file.id, record.dataOrigin, { signal })
    },
    errorMessage: cause => cause instanceof Error ? cause.message : receiptProblemFromUnknown(cause).problem.message,
    exportFile: options.exportFile,
  })
}
