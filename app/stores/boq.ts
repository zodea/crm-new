import type {
  CreateBoqChangeOrderDraft,
  ReviseApprovedBoqChangeOrderDraft,
} from '~/lib/boq/change'
import type { PersistBoqImportInput } from '~/lib/boq/import'
import type { BoqLinePatch } from '~/lib/boq/lines'
import type { MonthlyStatementView } from '~/lib/boq/monthly'
import type { BoqOriginalInput } from '~/lib/boq/production-contract'
import type { BoqCatalogProject, BoqWorkspace } from '~/lib/boq/read-model'
import type { ExportFileOptions } from '~/lib/kit/export'
import type { QuantityBasis } from '~/lib/quantity/basis'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef, watch } from 'vue'
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
import { productionBoqWorkspaceProjection } from '~/lib/boq/production-projection'
import { loadBoqCatalog, loadBoqWorkspace } from '~/lib/boq/read-model'
import { execute, select, withTransaction } from '~/lib/db/connection'
import {
  logCreate,
  softDelete,
  undoOperation,
} from '~/lib/db/soft-delete'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { useProductionBoqStore } from '~/stores/boq-production'
import { useProductionAccessStore } from '~/stores/production-access'

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
  const access = useProductionAccessStore()
  const central = useProductionBoqStore()
  const formal = computed(() => access.status?.mode === 'production' || (access.status?.mode !== 'development'))
  watch(() => [access.status?.mode, access.status?.mode === 'production' ? access.status.ownerId : undefined, access.status?.authenticated], () => central.clearWorkspace())
  const formalWorkspace = computed(() => {
    const source = central.workspace
    if (!source)
      return null
    const parent = central.directory?.contracts.find(row => row.id === source.contractId)
    return productionBoqWorkspaceProjection(source, parent?.projectName ?? '', parent?.name ?? '', parent?.no ?? '')
  })
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
    if (formal.value)
      return central.loadCatalog()
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

  function clearWorkspace() {
    if (formal.value)
      return central.clearWorkspace()
    latestWorkspaceRequest += 1
    latestMonthlyRequest += 1
    activeProjectId = ''
    activeContractId = ''
    workspace.value = null
    monthlyStatement.value = null
    error.value = ''
  }

  async function loadWorkspace(projectId: string, contractId: string) {
    if (formal.value)
      return central.loadWorkspace(projectId, contractId)
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
    if (formal.value)
      throw new Error('正式甲方报量未采用此本地源单，请保留原清单')
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
    if (formal.value) {
      const line = central.workspace?.lines.find(row => row.id === lineId)
      if (!line)
        throw new Error('请先读取原施工主合同的清单行')
      return central.execute({ kind: 'patch-line', lineId, version: line.version, patch })
    }
    return save('清单行保存', () => withTransaction(tx => persistBoqLinePatch(tx, lineId, patch)))
  }

  async function removeLine(lineId: string) {
    if (formal.value) {
      const line = central.workspace?.lines.find(row => row.id === lineId)
      if (!line)
        throw new Error('请先读取原清单行')
      await central.execute({ kind: 'delete-line', lineId, version: line.version })
      return null
    }
    return save('清单行删除', () => withTransaction(tx => softDelete(tx, 'boq_lines', lineId)))
  }

  async function importWorkbook(input: PersistBoqImportInput & { original?: BoqOriginalInput }) {
    if (formal.value) {
      if (!input.original)
        throw new Error('正式采用必须提供完整原清单文件')
      const saved = await central.importWorkbook({ ...input, original: input.original })
      return { fileId: saved.fileId!, lineCount: saved.lineIds?.length ?? 0, unitPriceCount: saved.priceIds?.length ?? 0, linkedTemplateLineCount: 0, logIds: [] }
    }
    activeProjectId = input.projectId
    activeContractId = input.contractId
    return save('清单导入', () => withTransaction(tx => persistBoqImport(tx, input)))
  }

  async function createChange(draft: CreateBoqChangeOrderDraft) {
    if (formal.value)
      return central.createChange(draft)
    activeProjectId = draft.projectId
    activeContractId = draft.contractId
    return save('变更单创建', () => withTransaction(tx => createBoqChangeOrder(tx, draft)))
  }

  async function transitionChange(
    orderId: string,
    target: 'submitted' | 'rejected',
    statusNote = '',
  ) {
    if (formal.value)
      return central.transitionChange(orderId, target, statusNote)
    return save(
      '变更单状态更新',
      () => withTransaction(tx => transitionBoqChangeOrder(tx, orderId, target, statusNote)),
    )
  }

  async function approveChange(orderId: string, approvedAt: string) {
    if (formal.value)
      return central.approveChange(orderId, approvedAt)
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
    if (formal.value)
      throw new Error('已签证更正须核对原冻结与后续引用，当前不回落本地重写')
    return save(
      '已签证变更更正',
      () => withTransaction(tx => reviseApprovedBoqChangeOrder(tx, orderId, draft, secondConfirmed)),
    )
  }

  async function removeChange(orderId: string, allowApproved = false) {
    if (formal.value)
      throw new Error('正式变洽签的历史与依赖仍保留，不能用本地删除撤除')
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
    if (formal.value)
      return central.attachmentChange(orderId, { add: [{ fileName: draft.fileName, fileSize: draft.fileSize, mimeType: draft.mimeType, category: draft.category, payloadBase64: draft.contentBase64 }] })
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
    if (formal.value) {
      const change = central.workspace?.changes.find(row => row.document.files.some(file => file.id === attachmentId && file.deletedAt === null))
      if (!change)
        throw new Error('原签证附件未从当前真实主合同读取')
      return central.originalFile('owner-change', change.id, attachmentId)
    }
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
    if (formal.value) {
      const change = central.workspace?.changes.find(row => row.document.files.some(file => file.id === attachmentId && file.deletedAt === null))
      if (!change)
        throw new Error('原签证附件未从当前真实主合同读取')
      await central.attachmentChange(change.id, { removeIds: [attachmentId] })
      return null
    }
    return save(
      '变更附件删除',
      () => withTransaction(tx => softDelete(tx, 'file_refs', attachmentId)),
    )
  }

  async function generateMonthly(
    month: string,
    basis: QuantityBasis = DEFAULT_PROGRESS_QUANTITY_BASIS,
  ) {
    if (formal.value)
      throw new Error('正式甲方报量源单尚未接通，不用本地数据生成')
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
    if (formal.value)
      throw new Error('甲方报量尚未接通正式源单，不用空量或本地记录补造')
    const result = await save(
      '月度报量换基准重算',
      () => withTransaction(tx => regenerateMonthlyStatement(tx, statementId, basis)),
    )
    await loadStatement(statementId)
    return result
  }

  async function adjustMonthly(lineId: string, adjustedQty: number, note: string) {
    if (formal.value)
      throw new Error('正式甲方报量来源尚未接通，不回落本地修改')
    const result = await save(
      '月度报量调整',
      () => withTransaction(tx => adjustMonthlyStatementLine(tx, lineId, adjustedQty, note)),
    )
    if (monthlyStatement.value)
      await loadStatement(monthlyStatement.value.id)
    return result
  }

  async function undo(logIds: readonly string[]) {
    if (formal.value)
      throw new Error('正式清单仅核对原命令与本域受保护恢复，不回落本地撤销')
    return save('撤回', () => withTransaction(async (tx) => {
      for (const logId of [...logIds].reverse())
        await undoOperation(tx, logId)
    }))
  }

  return {
    catalog: computed(() => formal.value ? central.catalog : catalog.value),
    workspace: computed(() => formal.value ? formalWorkspace.value : workspace.value),
    monthlyStatement: readonly(monthlyStatement),
    loading: computed(() => formal.value ? central.loading : loading.value),
    saving: computed(() => formal.value ? central.saving : saving.value),
    error: computed(() => formal.value ? central.error : error.value),
    production: formal,
    pending: computed(() => formal.value ? central.pending : []),
    recover: central.recover,
    prices: computed(() => formal.value ? central.workspace?.prices ?? [] : []),
    loadCatalog,
    clearWorkspace,
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
    originalFiles: computed(() => formal.value ? central.workspace?.files ?? [] : []),
    savedCommands: computed(() => formal.value ? central.savedCommands : []),
    loadOriginalFile: (ownerId: string, fileRefId: string) => central.originalFile('boq-file', ownerId, fileRefId),
    removeAttachment,
    generateMonthly,
    regenerateMonthly,
    adjustMonthly,
    undo,
  }
})
