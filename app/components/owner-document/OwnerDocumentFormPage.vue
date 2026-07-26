<script setup lang="ts">
import type {
  FileRefChanges,
  FileRefDraft,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import type {
  OwnerDocumentBoqLine,
  OwnerDocumentDraft,
  OwnerDocumentKind,
  OwnerDocumentSaveAction,
  PenaltyDeductionView,
} from '~/lib/owner-document/forms'
import { isTauri } from '@tauri-apps/api/core'
import { useDebounceFn } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import {
  listOwnerDocumentAttachments,
  listOwnerDocumentBoqLines,
  loadOwnerDocumentForm,
  loadPenaltyDeductions,
} from '~/lib/owner-document/forms'
import {
  OWNER_DOCUMENT_META,
  ownerDocumentDefaults,
  ownerDocumentFormPath,
} from '~/lib/owner-document/page'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

type PendingFileRef = FileRefDraft & { localId: string }

const props = defineProps<{
  kind: OwnerDocumentKind
}>()

const route = useRoute()
const store = useOwnerDocumentStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const meta = computed(() => OWNER_DOCUMENT_META[props.kind])
const routeId = computed(() => {
  const value = route.params.id
  const id = Array.isArray(value) ? value[0] : value
  return id === 'new' ? undefined : id
})
const isEditing = computed(() => Boolean(routeId.value))
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)
const title = computed(() => `${isEditing.value ? '查看/编辑' : '新建'} · ${meta.value.label}`)
useTabTitle(title)

const draft = ref<OwnerDocumentDraft>(ownerDocumentDefaults(props.kind))
const boqLines = shallowRef<OwnerDocumentBoqLine[]>([])
const attachments = shallowRef<FileRefRecord[]>([])
const pendingAttachments = shallowRef<PendingFileRef[]>([])
const pendingRemoveIds = shallowRef<string[]>([])
const pendingRestoreIds = shallowRef<string[]>([])
const fieldErrors = shallowRef<Record<string, string>>({})
const penaltyDeductions = shallowRef<PenaltyDeductionView[]>([])
const deductionSettlementId = shallowRef<string | null>(null)
const deductionAmount = shallowRef<number | null>(null)
const deductionNote = shallowRef('')
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const lifecycleLoading = shallowRef(false)
const closeAfterSave = shallowRef(true)
const desktopAttachmentPicker = shallowRef(false)
const savedSnapshot = shallowRef('')
let allowLeave = false

const status = computed(() => String(draft.value.status ?? 'draft'))
const editable = computed(() => status.value === 'draft' || status.value === 'rejected')
const auditMode = computed(() => props.kind === 'owner_report' && status.value === 'reported')
const canApproveChange = computed(() =>
  props.kind === 'owner_change' && status.value === 'submitted',
)
const canDeductPenalty = computed(() =>
  props.kind === 'project_penalty'
  && ['pending', 'repairing', 'repaired_self', 'repaired_other'].includes(status.value)
  && Number(draft.value.remainingDeductionAmount ?? draft.value.amount ?? 0) > 0,
)
const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0
  || pendingRestoreIds.value.length > 0,
)
const footerActions = computed<FormFooterAction[]>(() =>
  editable.value
    ? ['cancel', 'draft', 'saveSubmit']
    : ['cancel', 'save'],
)
const footerLabels = computed(() => ({
  saveSubmit: meta.value.postLabel,
  save: '保存附件',
}))

function statusLabel(value: string): string {
  return {
    draft: '草稿',
    submitted: '已提交',
    adjusted: '已申报',
    reported: '已申报',
    exported: '已审定',
    audited: '已审定',
    approved: '已签证',
    confirmed: '已确认',
    pending: '待抵扣',
    repairing: '整改中',
    repaired_self: '自行整改',
    repaired_other: '代为整改',
    deducted: '已抵扣',
    rejected: '已退回',
  }[value] ?? value
}

async function basicLookup(
  table: 'projects' | 'suppliers' | 'crews',
  keyword: string,
): Promise<LookupOption[]> {
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{ id: string, name: string }>(
    selectVisibleSql(table, 'AND name LIKE ? ORDER BY name LIMIT 50'),
    [pattern],
  )
  return rows.map(row => ({ id: row.id, label: row.name }))
}

const fetchProjects = (keyword: string) => basicLookup('projects', keyword)
const fetchSuppliers = (keyword: string) => basicLookup('suppliers', keyword)
const fetchCrews = (keyword: string) => basicLookup('crews', keyword)

async function fetchContracts(keyword: string): Promise<LookupOption[]> {
  if (!draft.value.projectId)
    return []
  const ownerSide = props.kind.startsWith('owner_')
    || props.kind === 'acceptance'
    || props.kind === 'final_settlement'
  const pattern = `%${keyword.trim()}%`
  const supplierId = typeof draft.value.supplierId === 'string'
    ? draft.value.supplierId
    : ''
  const rows = await select<{
    id: string
    no: string
    name: string
    supplier_name: string
  }>(`
    SELECT contract.id, contract.no, contract.name,
           COALESCE(supplier.name, '') AS supplier_name
    FROM contracts contract
    LEFT JOIN suppliers supplier
      ON supplier.id = contract.supplier_id AND supplier.deleted_at IS NULL
    WHERE contract.deleted_at IS NULL
      AND contract.project_id = ?
      AND ${ownerSide ? 'contract.kind = \'施工\'' : 'contract.kind <> \'施工\''}
      AND (? = '' OR contract.supplier_id = ?)
      AND (contract.no LIKE ? OR contract.name LIKE ?)
    ORDER BY contract.sign_date DESC, contract.created_at DESC
    LIMIT 50
  `, [draft.value.projectId, ownerSide ? '' : supplierId, supplierId, pattern, pattern])
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: `${row.no || '未编号'}${row.supplier_name ? ` · ${row.supplier_name}` : ''}`,
  }))
}

async function fetchSettlements(keyword: string): Promise<LookupOption[]> {
  if (!draft.value.projectId)
    return []
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{
    id: string
    no: string
    name: string
    total_amount: number
  }>(`
    SELECT id, no, name, total_amount
    FROM expenditure_settlements
    WHERE deleted_at IS NULL
      AND biz_type = '分包'
      AND project_id = ?
      AND (? = '' OR supplier_id = ?)
      AND (? = '' OR contract_id = ?)
      AND (no LIKE ? OR name LIKE ?)
    ORDER BY settlement_date DESC, created_at DESC
    LIMIT 50
  `, [
    draft.value.projectId,
    String(draft.value.supplierId ?? ''),
    String(draft.value.supplierId ?? ''),
    String(draft.value.contractId ?? ''),
    String(draft.value.contractId ?? ''),
    pattern,
    pattern,
  ])
  return rows.map(row => ({
    id: row.id,
    label: row.name || row.no,
    hint: `${row.no || '未编号'} · ¥${Number(row.total_amount).toLocaleString('zh-CN')}`,
  }))
}

const refreshBoqLines = useDebounceFn(async () => {
  const projectId = typeof draft.value.projectId === 'string' ? draft.value.projectId : ''
  const contractId = typeof draft.value.contractId === 'string' ? draft.value.contractId : ''
  if (!projectId || !contractId || !['owner_change', 'owner_report'].includes(props.kind)) {
    boqLines.value = []
    return
  }
  try {
    boqLines.value = await listOwnerDocumentBoqLines(
      projectId,
      contractId,
      props.kind === 'owner_report' ? String(draft.value.periodNo ?? '') : '',
    )
    if (props.kind === 'owner_report' && editable.value) {
      const current = draft.value.lines ?? []
      const byId = new Map(boqLines.value.map(line => [line.id, line]))
      const lines = current.length
        ? current.map((line) => {
            const boqLine = byId.get(String(line.boqLineId ?? ''))
            return boqLine ? { ...line, autoQty: boqLine.autoQty } : line
          })
        : boqLines.value
            .filter(line => line.autoQty > 0)
            .map(line => ({
              boqLineId: line.id,
              itemName: line.itemName,
              unit: line.unit,
              autoQty: line.autoQty,
              reportedQty: line.autoQty,
              auditedQty: null,
              unitPrice: line.unitPrice,
              note: '',
            }))
      if (lines.length)
        patchLines(lines)
    }
  }
  catch (cause) {
    boqLines.value = []
    error(`载入合同清单失败：${toErrorMessage(cause)}`)
  }
}, 150)

const refreshContractSummary = useDebounceFn(async () => {
  const contractId = typeof draft.value.contractId === 'string'
    ? draft.value.contractId
    : ''
  if (!contractId) {
    if (props.kind === 'final_settlement') {
      draft.value = {
        ...draft.value,
        changedContractAmount: null,
        receivedAmount: null,
        settlementReceiptGap: null,
      }
    }
    if (props.kind === 'sub_settlement') {
      draft.value = {
        ...draft.value,
        contractAmount: null,
        priorSettlementAmount: null,
        settlementRatio: null,
      }
    }
    return
  }
  if (props.kind === 'final_settlement') {
    const [contract] = await select<{ amount: number, changed: number, paid: number }>(
      `SELECT amount, changed, paid FROM contracts
       WHERE id = ? AND deleted_at IS NULL`,
      [contractId],
    )
    if (!contract)
      return
    const changedContractAmount = Number(contract.changed || contract.amount) || 0
    const receivedAmount = Number(contract.paid) || 0
    const settlementAmount = Number(draft.value.settlementAmount) || 0
    draft.value = {
      ...draft.value,
      changedContractAmount,
      receivedAmount,
      settlementReceiptGap: Math.round((settlementAmount - receivedAmount) * 100) / 100,
    }
  }
  if (props.kind === 'sub_settlement') {
    const [contract] = await select<{ amount: number }>(
      `SELECT amount FROM contracts WHERE id = ? AND deleted_at IS NULL`,
      [contractId],
    )
    const [settled] = await select<{ amount: number }>(`
      SELECT COALESCE(SUM(total_amount), 0) AS amount
      FROM expenditure_settlements
      WHERE biz_type = '分包'
        AND contract_id = ?
        AND deleted_at IS NULL
        AND (? = '' OR id <> ?)
    `, [contractId, routeId.value ?? '', routeId.value ?? ''])
    const contractAmount = Number(contract?.amount) || 0
    const totalAmount = Number(draft.value.totalAmount) || 0
    draft.value = {
      ...draft.value,
      contractAmount,
      priorSettlementAmount: Number(settled?.amount) || 0,
      settlementRatio: contractAmount > 0
        ? `${(totalAmount / contractAmount * 100).toFixed(2)}%`
        : '—',
    }
  }
}, 150)

async function initialize() {
  loading.value = true
  fieldErrors.value = {}
  resetPendingAttachments()
  try {
    const id = routeId.value
    if (!id) {
      draft.value = ownerDocumentDefaults(props.kind)
      attachments.value = []
      penaltyDeductions.value = []
    }
    else {
      const [record, files, deductions] = await Promise.all([
        loadOwnerDocumentForm(props.kind, id),
        listOwnerDocumentAttachments(props.kind, id, true),
        props.kind === 'project_penalty' ? loadPenaltyDeductions(id) : Promise.resolve([]),
      ])
      if (!record) {
        error(`${meta.value.label}不存在或已删除`)
        allowLeave = true
        await navigateTo(meta.value.listPath)
        return
      }
      draft.value = {
        ...ownerDocumentDefaults(props.kind),
        ...record,
      }
      attachments.value = files
      penaltyDeductions.value = deductions
    }
    await refreshBoqLines()
    await refreshContractSummary()
    updateDerivedAmounts()
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
  }
  catch (cause) {
    error(`载入失败：${toErrorMessage(cause)}`)
  }
  finally {
    loading.value = false
  }
}

function patchDraft(patch: Partial<OwnerDocumentDraft>) {
  const next = { ...draft.value, ...patch }
  if ('projectId' in patch) {
    next.contractId = null
    if (!next.projectId)
      next.supplierId = null
  }
  if ('supplierId' in patch)
    next.contractId = null
  draft.value = next
  if ('projectId' in patch || 'contractId' in patch || 'periodNo' in patch)
    void refreshBoqLines()
  if (
    'projectId' in patch
    || 'contractId' in patch
    || 'totalAmount' in patch
    || 'settlementAmount' in patch
  ) {
    void refreshContractSummary()
  }
}

function patchLines(lines: Array<Record<string, unknown>>) {
  draft.value = { ...draft.value, lines }
  updateDerivedAmounts()
}

function lineAmount(line: Record<string, unknown>): number {
  if (props.kind === 'owner_report')
    return (Number(line.reportedQty) || 0) * (Number(line.unitPrice) || 0)
  const operation = String(line.operation ?? 'qty')
  const qty = Number(line.qty) || 0
  const deltaQty = Number(line.deltaQty) || 0
  const unitPrice = Number(line.unitPrice) || 0
  const newUnitPrice = Number(line.newUnitPrice) || 0
  if (operation === 'add')
    return deltaQty * newUnitPrice
  if (operation === 'price')
    return qty * (newUnitPrice - unitPrice)
  return deltaQty * unitPrice
}

function updateDerivedAmounts() {
  const lines = draft.value.lines ?? []
  const amount = lines.reduce((sum, line) => sum + lineAmount(line), 0)
  if (props.kind === 'owner_change')
    draft.value = { ...draft.value, totalAmount: Math.round(amount * 100) / 100 }
  if (props.kind === 'owner_report')
    draft.value = { ...draft.value, reportedAmount: Math.round(amount * 100) / 100 }
}

function clearFieldError(field: string) {
  if (!fieldErrors.value[field])
    return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function validateSubmit(): boolean {
  const errors: Record<string, string> = {}
  const require = (field: string, label: string, positive = false) => {
    const value = draft.value[field]
    const missing = positive
      ? !(Number(value) > 0)
      : typeof value === 'string' ? !value.trim() : value == null
    if (missing)
      errors[field] = `${label}为必填项`
  }
  switch (props.kind) {
    case 'owner_change':
      require('name', '变更名称')
      require('projectId', '项目')
      require('contractId', '施工合同')
      require('applicationDate', '申报日期')
      require('reason', '变更事由')
      if (!(draft.value.lines?.length) && !(
        Number(draft.value.approvedTaxInclusiveAmount) > 0
        || Number(draft.value.approvedTaxExclusiveAmount) > 0
      )) {
        errors.lines = '至少填写一条量价变更，或填写纯金额签证金额'
      }
      break
    case 'owner_report':
      require('projectId', '项目')
      require('contractId', '施工合同')
      require('periodNo', '报量期次')
      require('applicationDate', '申报日期')
      if (!draft.value.lines?.length)
        errors.lines = '至少填写一条报量明细'
      break
    case 'acceptance':
      require('name', '名称')
      require('projectId', '项目')
      require('documentDate', '日期')
      break
    case 'final_settlement':
      require('name', '结算名称')
      require('projectId', '项目')
      require('settlementAmount', '结算金额', true)
      require('submissionDate', '报审日期')
      break
    case 'owner_penalty':
      require('projectId', '项目')
      require('amount', '罚扣金额', true)
      require('penaltyDate', '罚扣日期')
      require('reason', '罚扣事由')
      break
    case 'sub_change':
      require('projectId', '项目')
      require('supplierId', '分供方')
      require('contractId', '支出合同')
      require('changeDate', '变更日期')
      require('approvedAmount', '审批金额', true)
      require('reason', '变更事由')
      break
    case 'sub_settlement':
      require('name', '结算名称')
      require('projectId', '项目')
      require('supplierId', '分供方')
      require('contractId', '支出合同')
      require('totalAmount', '结算金额', true)
      require('settlementDate', '结算日期')
      break
    case 'project_penalty':
      require('projectId', '项目')
      require('amount', '罚扣金额', true)
      require('penaltyDate', '罚扣日期')
      require('reason', '罚扣事由')
      break
  }
  fieldErrors.value = errors
  const messages = Object.values(errors)
  if (messages.length)
    warning(`${messages[0]}（共 ${messages.length} 处）`)
  return messages.length === 0
}

function attachmentChanges(): FileRefChanges {
  return {
    add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
    removeIds: pendingRemoveIds.value,
    restoreIds: pendingRestoreIds.value,
  }
}

function resetPendingAttachments() {
  pendingAttachments.value = []
  pendingRemoveIds.value = []
  pendingRestoreIds.value = []
}

async function persist(action: OwnerDocumentSaveAction, footerAction: FormFooterAction) {
  if (action === 'submit' && !validateSubmit())
    return
  if (action === 'submit') {
    const accepted = await confirm({
      variant: 'simple',
      title: meta.value.postLabel.replace('保存并', ''),
      message: meta.value.postMessage,
      confirmLabel: meta.value.postLabel.replace('保存并', ''),
    })
    if (!accepted)
      return
  }
  loadingAction.value = footerAction
  try {
    const result = await store.saveForm(
      props.kind,
      draft.value,
      action,
      attachmentChanges(),
    )
    success(action === 'submit' ? `${meta.value.postLabel.replace('保存并', '')}成功` : '草稿已保存')
    resetPendingAttachments()
    fieldErrors.value = {}
    if (action === 'submit' && closeAfterSave.value) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(meta.value.listPath)
      return
    }
    allowLeave = true
    await navigateTo(ownerDocumentFormPath(props.kind, result.id), { replace: true })
    await initialize()
    allowLeave = false
  }
  catch (cause) {
    error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

async function saveFinalAttachments() {
  const id = routeId.value
  if (!id)
    return
  loadingAction.value = 'save'
  try {
    await store.saveAttachments(props.kind, id, attachmentChanges())
    success('附件已保存')
    await initialize()
  }
  catch (cause) {
    error(`附件保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveToList()
    return
  }
  if (!editable.value) {
    await saveFinalAttachments()
    return
  }
  await persist(action === 'saveSubmit' ? 'submit' : 'draft', action)
}

async function approveChange() {
  const id = routeId.value
  if (!id)
    return
  const accepted = await confirm({
    variant: 'cascade',
    title: '确认甲方签证',
    message: '签证后将生成并锁定收入变更台账，量价事实不可直接回退。',
    requireTyping: String(draft.value.name ?? draft.value.no ?? meta.value.label),
    impact: [
      { label: '锁定收入变更台账', n: 1 },
      { label: '变更明细', n: draft.value.lines?.length ?? 0 },
    ],
    confirmLabel: '确认签证',
  })
  if (!accepted)
    return
  lifecycleLoading.value = true
  try {
    const today = new Date().toISOString().slice(0, 10)
    await store.approveOwnerChange(id, today)
    success('甲方签证已生效，收入变更台账已锁定')
    await initialize()
  }
  catch (cause) {
    error(`签证失败：${toErrorMessage(cause)}`)
  }
  finally {
    lifecycleLoading.value = false
  }
}

async function auditReport() {
  const id = routeId.value
  if (!id)
    return
  const lines = (draft.value.lines ?? []).map(line => ({
    boqLineId: String(line.boqLineId ?? ''),
    auditedQty: Number(line.auditedQty),
    auditedAmount: (Number(line.auditedQty) || 0) * (Number(line.unitPrice) || 0),
  }))
  if (lines.some(line => !line.boqLineId || !Number.isFinite(line.auditedQty) || line.auditedQty < 0)) {
    warning('请为每条报量明细填写有效的审定量')
    return
  }
  const auditedAmount = lines.reduce((sum, line) => sum + line.auditedAmount, 0)
  const accepted = await confirm({
    variant: 'simple',
    title: '确认甲方审定',
    message: `本次审定金额 ¥${auditedAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}，确认后锁定审定量。`,
    confirmLabel: '确认审定',
  })
  if (!accepted)
    return
  lifecycleLoading.value = true
  try {
    await store.auditOwnerReport(id, { auditedAmount, lines })
    success('甲方报量已审定')
    await initialize()
  }
  catch (cause) {
    error(`审定失败：${toErrorMessage(cause)}`)
  }
  finally {
    lifecycleLoading.value = false
  }
}

async function deductPenalty() {
  const id = routeId.value
  if (!id || !deductionSettlementId.value || !(Number(deductionAmount.value) > 0)) {
    warning('请选择结算单并填写大于 0 的抵扣金额')
    return
  }
  const accepted = await confirm({
    variant: 'cascade',
    title: '确认结算抵扣',
    message: `将在所选分包结算中抵扣 ¥${Number(deductionAmount.value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}，并保存独立抵扣关系。`,
    requireTyping: String(draft.value.no ?? meta.value.label),
    impact: [
      { label: '项目罚扣记录', n: 1 },
      { label: '分包结算抵扣', n: 1 },
    ],
    confirmLabel: '执行抵扣',
  })
  if (!accepted)
    return
  lifecycleLoading.value = true
  try {
    await store.deductProjectPenalty(
      id,
      deductionSettlementId.value,
      Number(deductionAmount.value),
      deductionNote.value,
    )
    success('项目罚扣已写入结算抵扣')
    deductionSettlementId.value = null
    deductionAmount.value = null
    deductionNote.value = ''
    await initialize()
  }
  catch (cause) {
    error(`抵扣失败：${toErrorMessage(cause)}`)
  }
  finally {
    lifecycleLoading.value = false
  }
}

function appendPendingAttachments(files: FileRefDraft[]) {
  const activeCount = attachments.value.filter(file => !file.deletedAt).length
    - pendingRemoveIds.value.length
    + pendingRestoreIds.value.length
  const available = Math.max(9 - activeCount - pendingAttachments.value.length, 0)
  if (files.length > available)
    warning(`每张单据最多保留 9 份附件，本次只加入前 ${available} 份`)
  pendingAttachments.value = [
    ...pendingAttachments.value,
    ...files.slice(0, available).map((file, index) => ({
      ...file,
      localId: `${file.filePath || file.fileName}-${Date.now()}-${index}`,
      category: file.category || '业务附件',
    })),
  ]
}

function handleFiles(files: File[]) {
  appendPendingAttachments(files.map(file => ({
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  })))
}

async function pickNativeFiles() {
  try {
    const [{ open }, { stat }, { basename }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/api/path'),
    ])
    const selected = await open({ multiple: true, directory: false })
    const paths = selected == null ? [] : Array.isArray(selected) ? selected : [selected]
    const files = await Promise.all(paths.map(async filePath => ({
      fileName: await basename(filePath),
      filePath,
      fileSize: (await stat(filePath)).size,
    })))
    appendPendingAttachments(files)
  }
  catch (cause) {
    error(`选择附件失败：${toErrorMessage(cause)}`)
  }
}

function toggleExistingAttachment(id: string) {
  const attachment = attachments.value.find(file => file.id === id)
  if (attachment?.deletedAt) {
    pendingRestoreIds.value = pendingRestoreIds.value.includes(id)
      ? pendingRestoreIds.value.filter(item => item !== id)
      : [...pendingRestoreIds.value, id]
    return
  }
  pendingRemoveIds.value = pendingRemoveIds.value.includes(id)
    ? pendingRemoveIds.value.filter(item => item !== id)
    : [...pendingRemoveIds.value, id]
}

function removePending(localId: string) {
  pendingAttachments.value = pendingAttachments.value.filter(file => file.localId !== localId)
}

function patchPending(localId: string, patch: Partial<PendingFileRef>) {
  pendingAttachments.value = pendingAttachments.value.map(file =>
    file.localId === localId ? { ...file, ...patch } : file,
  )
}

async function leaveToList() {
  if (dirty.value) {
    const leave = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前表单还有未保存内容，确认放弃并返回列表？',
      confirmLabel: '放弃修改',
    })
    if (!leave)
      return
  }
  allowLeave = true
  tabsStore.close(pageKey)
  await navigateTo(meta.value.listPath)
}

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true
  if (tabsStore.tabs.some(tab => tab.key === pageKey))
    return true
  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  if (!leave)
    tabsStore.open({ fullPath: pageFullPath, title: title.value })
  return leave
})

onMounted(() => {
  desktopAttachmentPicker.value = isTauri()
  void initialize()
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-1340px items-start gap-4 pb-6">
    <aside
      v-if="meta.sections.length >= 3"
      class="sticky top-4 hidden w-44 shrink-0 rounded-[var(--radius-card)] border border-line bg-panel p-2 xl:block"
      aria-label="表单分区"
    >
      <a
        v-for="section in meta.sections"
        :key="section.key"
        :href="`#section-${section.key}`"
        class="block rounded-[var(--radius-control)] px-3 py-2 text-12px text-ink-soft transition-colors hover:bg-brand-soft hover:text-brand-deep"
      >
        {{ section.label }}
      </a>
    </aside>

    <main class="min-w-0 flex-1">
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" class="mb-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-12px text-brand-deep" @click="leaveToList">
            <span class="i-lucide-arrow-left" aria-hidden="true" />返回{{ meta.label }}
          </button>
          <h1 class="text-20px font-800 text-ink">
            {{ title }}
          </h1>
          <p class="mt-1 text-12px text-ink-faint">
            {{ meta.subtitle }}；关联对象均保存真实 ID，附件与业务单据同事务提交。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip" :class="editable ? 'chip-brand' : 'chip-ok'">
            {{ statusLabel(status) }}
          </span>
          <KitButton
            v-if="canApproveChange"
            :loading="lifecycleLoading"
            @click="approveChange"
          >
            <span class="i-lucide-badge-check mr-1" aria-hidden="true" />确认签证
          </KitButton>
          <KitButton
            v-if="auditMode"
            :loading="lifecycleLoading"
            @click="auditReport"
          >
            <span class="i-lucide-stamp mr-1" aria-hidden="true" />确认审定
          </KitButton>
        </div>
      </header>

      <div v-if="loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
        正在载入表单…
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent>
        <OwnerDocumentFormFields
          :kind="kind"
          :draft="draft"
          :field-errors="fieldErrors"
          :readonly="!editable"
          :fetch-projects="fetchProjects"
          :fetch-suppliers="fetchSuppliers"
          :fetch-contracts="fetchContracts"
          :fetch-crews="fetchCrews"
          @patch="patchDraft"
          @clear-error="clearFieldError"
        />

        <OwnerDocumentLineGrid
          v-if="kind === 'owner_change' || kind === 'owner_report'"
          :kind="kind"
          :lines="draft.lines ?? []"
          :boq-lines="boqLines"
          :readonly="!editable"
          :audit-mode="auditMode"
          @update="patchLines"
        />

        <section
          v-if="kind === 'project_penalty' && (canDeductPenalty || penaltyDeductions.length)"
          id="section-deduction"
          class="panel scroll-mt-4 p-4"
        >
          <SectionHeader title="结算抵扣" />
          <div v-if="canDeductPenalty" class="form-fields-grid mt-3">
            <div class="field-block">
              <span class="field-label">分包结算 *</span>
              <LookupSelect
                v-model="deductionSettlementId"
                :fetch="fetchSettlements"
                recent-key="project-penalty-settlement"
                placeholder="检索可抵扣的分包结算"
              />
            </div>
            <label class="field-block">
              <span class="field-label">本次抵扣金额 *</span>
              <input v-model.number="deductionAmount" type="number" min="0.01" step="0.01" class="field-input w-full font-mono">
            </label>
            <label class="field-block form-span-full">
              <span class="field-label">抵扣说明</span>
              <textarea v-model="deductionNote" rows="2" class="field-input w-full" />
            </label>
            <div class="form-span-full flex justify-end">
              <KitButton :loading="lifecycleLoading" @click="deductPenalty">
                <span class="i-lucide-circle-minus mr-1" aria-hidden="true" />执行结算抵扣
              </KitButton>
            </div>
          </div>
          <div v-if="penaltyDeductions.length" class="mt-4 grid gap-2">
            <div
              v-for="item in penaltyDeductions"
              :key="item.id"
              class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-12px"
            >
              <strong class="text-ink">{{ item.settlementNo }} · {{ item.settlementName }}</strong>
              <span class="font-mono font-700 text-danger">-¥{{ item.amount.toFixed(2) }}</span>
              <span class="text-ink-faint">{{ item.note || '无说明' }}</span>
              <span class="ml-auto text-ink-faint">{{ item.createdAt }}</span>
            </div>
          </div>
        </section>

        <FileRefAttachmentSection
          :attachments="attachments"
          :pending-attachments="pendingAttachments"
          :pending-remove-ids="pendingRemoveIds"
          :pending-restore-ids="pendingRestoreIds"
          :desktop-picker="desktopAttachmentPicker"
          :note="String(draft.note ?? '')"
          :note-readonly="!editable"
          @pick-native="pickNativeFiles"
          @files="handleFiles"
          @toggle-existing="toggleExistingAttachment"
          @remove-pending="removePending"
          @patch-pending="patchPending"
          @update-note="patchDraft({ note: $event })"
        />

        <FormFooter
          v-model="closeAfterSave"
          :actions="footerActions"
          :labels="footerLabels"
          :dirty="dirty"
          :close-after-save="editable"
          :loading-action="loadingAction"
          @action="handleFooterAction"
        />
      </form>
    </main>
  </div>
</template>
