import type {
  CreateBoqChangeOrderDraft,
  ReviseApprovedBoqChangeOrderDraft,
} from '~/lib/boq/change'
import type { PersistBoqImportInput } from '~/lib/boq/import'
import type { BoqLinePatch } from '~/lib/boq/lines'
import type { MonthlyStatementView } from '~/lib/boq/monthly'
import type { BoqCatalogProject, BoqWorkspace } from '~/lib/boq/read-model'
import type { ExportFileOptions } from '~/lib/kit/export'
import type { QuantityBasis } from '~/lib/quantity/basis'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import {
  approveBoqChangeOrder,
  createBoqChangeOrder,
  reviseApprovedBoqChangeOrder,
  transitionBoqChangeOrder,
} from '~/lib/boq/change'
import { persistBoqImport } from '~/lib/boq/import'
import { persistBoqLinePatch } from '~/lib/boq/lines'
import {
  adjustMonthlyStatementLine,
  DEFAULT_PROGRESS_QUANTITY_BASIS,
  generateMonthlyStatement,
  loadMonthlyStatement,
  regenerateMonthlyStatement,
} from '~/lib/boq/monthly'
import { loadBoqCatalog, loadBoqWorkspace } from '~/lib/boq/read-model'
import { execute, select, withTransaction } from '~/lib/db/connection'
import {
  logCreate,
  softDelete,
  undoOperation,
} from '~/lib/db/soft-delete'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'

const db = { execute, select }

export type BoqAttachmentCategory
  = | 'our_directive'
    | 'owner_directive'
    | 'quotation'
    | 'quantity_calculation'
    | 'construction_photo'

export interface BoqAttachmentDraft {
  fileName: string
  filePath?: string
  fileSize?: number
  mimeType: string
  contentBase64: string
  category: BoqAttachmentCategory
}

export const useBoqStore = defineStore('boq', () => {
  const catalog = shallowRef<BoqCatalogProject[]>([])
  const workspace = shallowRef<BoqWorkspace | null>(null)
  const monthlyStatement = shallowRef<MonthlyStatementView | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  let activeProjectId = ''
  let activeContractId = ''
  let latestWorkspaceRequest = 0
  let latestMonthlyRequest = 0

  async function loadCatalog() {
    loading.value = true
    error.value = ''
    try {
      catalog.value = await loadBoqCatalog(db)
    }
    catch (cause) {
      catalog.value = []
      error.value = `工程量清单目录加载失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function loadWorkspace(projectId: string, contractId: string) {
    const request = ++latestWorkspaceRequest
    activeProjectId = projectId
    activeContractId = contractId
    if (workspace.value?.projectId !== projectId || workspace.value.contractId !== contractId)
      workspace.value = null
    loading.value = true
    error.value = ''
    try {
      const result = projectId && contractId
        ? await loadBoqWorkspace(db, projectId, contractId)
        : null
      if (request === latestWorkspaceRequest)
        workspace.value = result
    }
    catch (cause) {
      if (request === latestWorkspaceRequest) {
        workspace.value = null
        error.value = `工程量清单加载失败：${toErrorMessage(cause)}`
      }
      throw cause
    }
    finally {
      if (request === latestWorkspaceRequest)
        loading.value = false
    }
  }

  async function loadStatement(statementId: string) {
    const request = ++latestMonthlyRequest
    if (monthlyStatement.value?.id !== statementId)
      monthlyStatement.value = null
    loading.value = true
    error.value = ''
    try {
      const result = statementId ? await loadMonthlyStatement(db, statementId) : null
      if (request === latestMonthlyRequest)
        monthlyStatement.value = result
    }
    catch (cause) {
      if (request === latestMonthlyRequest) {
        monthlyStatement.value = null
        error.value = `月度报量加载失败：${toErrorMessage(cause)}`
      }
      throw cause
    }
    finally {
      if (request === latestMonthlyRequest)
        loading.value = false
    }
  }

  async function reloadWorkspace() {
    await Promise.all([
      loadCatalog(),
      loadWorkspace(activeProjectId, activeContractId),
    ])
  }

  async function save<T>(label: string, work: () => Promise<T>, reload = true): Promise<T> {
    saving.value = true
    error.value = ''
    try {
      const result = await work()
      if (reload)
        await reloadWorkspace()
      return result
    }
    catch (cause) {
      error.value = `${label}失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      saving.value = false
    }
  }

  async function updateLine(lineId: string, patch: BoqLinePatch) {
    return save('清单行保存', () => withTransaction(tx => persistBoqLinePatch(tx, lineId, patch)))
  }

  async function removeLine(lineId: string) {
    return save('清单行删除', () => withTransaction(tx => softDelete(tx, 'boq_lines', lineId)))
  }

  async function importWorkbook(input: PersistBoqImportInput) {
    activeProjectId = input.projectId
    activeContractId = input.contractId
    return save('清单导入', () => withTransaction(tx => persistBoqImport(tx, input)))
  }

  async function createChange(draft: CreateBoqChangeOrderDraft) {
    activeProjectId = draft.projectId
    activeContractId = draft.contractId
    return save('变更单创建', () => withTransaction(tx => createBoqChangeOrder(tx, draft)))
  }

  async function transitionChange(
    orderId: string,
    target: 'submitted' | 'rejected',
    statusNote = '',
  ) {
    return save(
      '变更单状态更新',
      () => withTransaction(tx => transitionBoqChangeOrder(tx, orderId, target, statusNote)),
    )
  }

  async function approveChange(orderId: string, approvedAt: string) {
    return save(
      '变更单签证',
      () => withTransaction(tx => approveBoqChangeOrder(tx, orderId, approvedAt)),
    )
  }

  async function reviseApprovedChange(
    orderId: string,
    draft: ReviseApprovedBoqChangeOrderDraft,
    secondConfirmed = false,
  ) {
    return save(
      '已签证变更更正',
      () => withTransaction(tx => reviseApprovedBoqChangeOrder(tx, orderId, draft, secondConfirmed)),
    )
  }

  async function removeChange(orderId: string, allowApproved = false) {
    return save('变更单删除', () => withTransaction(async (tx) => {
      const [order] = await tx.select<{ status: string, ledger_id: string | null }>(
        `SELECT status, ledger_id
         FROM boq_change_orders
         WHERE id = ? AND deleted_at IS NULL`,
        [orderId],
      )
      if (!order)
        return []
      if (order.status === 'approved' && !allowApproved)
        throw new Error('删除已签证变更需要级联二次确认')
      const logIds: string[] = []
      if (order.ledger_id) {
        const ledgerLogId = await softDelete(tx, 'owner_change_orders', order.ledger_id)
        if (ledgerLogId)
          logIds.push(ledgerLogId)
      }
      const orderLogId = await softDelete(tx, 'boq_change_orders', orderId)
      if (orderLogId)
        logIds.push(orderLogId)
      return logIds
    }))
  }

  async function addChangeAttachment(orderId: string, draft: BoqAttachmentDraft) {
    return save('变更附件保存', () => withTransaction(async (tx) => {
      const [order] = await tx.select<{ id: string }>(
        `SELECT id FROM boq_change_orders WHERE id = ? AND deleted_at IS NULL`,
        [orderId],
      )
      if (!order)
        throw new Error('变更单不存在或已删除')
      if (!draft.fileName.trim())
        throw new Error('附件文件名必填')
      if (!draft.contentBase64)
        throw new Error('附件正文为空，请重新选择文件')
      const id = generateId('file')
      await tx.execute(
        `INSERT INTO file_refs
          (id, owner_type, owner_id, file_name, file_path, file_size, category, mime_type)
         VALUES (?, 'boq_change_order', ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orderId,
          draft.fileName.trim(),
          draft.filePath?.trim() ?? '',
          draft.fileSize ?? 0,
          draft.category,
          draft.mimeType || 'application/octet-stream',
        ],
      )
      await tx.execute(
        `INSERT INTO file_payloads (file_ref_id, encoding, content)
         VALUES (?, 'base64', ?)`,
        [id, draft.contentBase64],
      )
      return { id, logId: await logCreate(tx, 'file_refs', id) }
    }))
  }

  async function loadAttachmentFile(attachmentId: string): Promise<ExportFileOptions> {
    const [attachment] = await select<{
      file_name: string
      mime_type: string
      encoding: string
      content: string
    }>(`
      SELECT file_ref.file_name, file_ref.mime_type, payload.encoding, payload.content
      FROM file_refs file_ref
      JOIN file_payloads payload ON payload.file_ref_id = file_ref.id
      WHERE file_ref.id = ?
        AND file_ref.owner_type = 'boq_change_order'
        AND file_ref.deleted_at IS NULL
    `, [attachmentId])
    if (!attachment)
      throw new Error('附件不存在、已删除或正文缺失')
    if (attachment.encoding !== 'base64')
      throw new Error(`不支持的附件编码：${attachment.encoding}`)
    const binary = atob(attachment.content)
    const data = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1)
      data[index] = binary.charCodeAt(index)
    return {
      data,
      defaultName: attachment.file_name,
      mimeType: attachment.mime_type || 'application/octet-stream',
    }
  }

  async function removeAttachment(attachmentId: string) {
    return save(
      '变更附件删除',
      () => withTransaction(tx => softDelete(tx, 'file_refs', attachmentId)),
    )
  }

  async function generateMonthly(
    month: string,
    basis: QuantityBasis = DEFAULT_PROGRESS_QUANTITY_BASIS,
  ) {
    const result = await save(
      '月度报量生成',
      () => withTransaction(tx => generateMonthlyStatement(
        tx,
        activeProjectId,
        activeContractId,
        month,
        basis,
      )),
    )
    await loadStatement(result.statementId)
    return result
  }

  async function regenerateMonthly(statementId: string, basis: QuantityBasis) {
    const result = await save(
      '月度报量换基准重算',
      () => withTransaction(tx => regenerateMonthlyStatement(tx, statementId, basis)),
    )
    await loadStatement(statementId)
    return result
  }

  async function adjustMonthly(lineId: string, adjustedQty: number, note: string) {
    const result = await save(
      '月度报量调整',
      () => withTransaction(tx => adjustMonthlyStatementLine(tx, lineId, adjustedQty, note)),
    )
    if (monthlyStatement.value)
      await loadStatement(monthlyStatement.value.id)
    return result
  }

  async function undo(logIds: readonly string[]) {
    return save('撤回', () => withTransaction(async (tx) => {
      for (const logId of [...logIds].reverse())
        await undoOperation(tx, logId)
    }))
  }

  return {
    catalog: readonly(catalog),
    workspace: readonly(workspace),
    monthlyStatement: readonly(monthlyStatement),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    loadCatalog,
    loadWorkspace,
    loadStatement,
    updateLine,
    removeLine,
    importWorkbook,
    createChange,
    transitionChange,
    approveChange,
    reviseApprovedChange,
    removeChange,
    addChangeAttachment,
    loadAttachmentFile,
    removeAttachment,
    generateMonthly,
    regenerateMonthly,
    adjustMonthly,
    undo,
  }
})
