<script setup lang="ts">
import type { CentralInvoiceFields, CentralInvoiceItem, CentralInvoiceRecord, InvoiceContractReference, InvoiceTaxVerificationSelection } from '~/lib/invoice/central-contract'
import type { CentralInvoiceFormSnapshot } from '~/lib/invoice/central-form-snapshot'
import type { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import type { LocalInvoiceCandidate } from '~/lib/invoice/recognize'
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useKitUI } from '~/composables/useKitUI'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { invoiceCandidateForCommand } from '~/lib/invoice/central-recognition'
import { CentralInvoiceLoadSupersededError, CentralInvoiceUploadNotSubmittedError } from '~/lib/invoice/central-workspace'
import CentralInvoiceOriginalVerification from './CentralInvoiceOriginalVerification.vue'
import CentralInvoiceWorkspaceView from './CentralInvoiceWorkspaceView.vue'

type Workspace = ReturnType<typeof createCentralInvoiceWorkspace>
interface ReferenceOption { id: string, label: string }
interface VersionedReferenceOption extends ReferenceOption { version: string }
interface ContractOption extends InvoiceContractReference { label: string, supplierId?: string | null }
const props = defineProps<{ workspace: Workspace, projects: readonly ReferenceOption[], suppliers: readonly VersionedReferenceOption[], signatories: readonly VersionedReferenceOption[], contracts?: readonly ContractOption[], cloudAvailable?: boolean, initialSelectedId?: string | null }>()
const { confirm, undoToast } = useKitUI()
const selectedId = shallowRef<string | null>(props.initialSelectedId ?? null)
const originalFile = shallowRef<File | null>(null)
const originalLoading = shallowRef(false)
const busy = shallowRef(false)
const uploadPreflight = shallowRef(false)
const recognizing = shallowRef(false)
const recognizingId = shallowRef<string | null>(null)
const dirty = shallowRef(false)
const error = shallowRef('')
const originalError = shallowRef('')
const pending = shallowRef<{ targetId: string | null, action: string, scopeId?: string } | null>(null)
const pendingUnavailable = shallowRef(false)
const batchResults = shallowRef<Array<{ name: string, status: string }> | null>(null)
const draft = shallowRef<{ workspace: Workspace, invoice: CentralInvoiceRecord, candidate: LocalInvoiceCandidate, before: CentralInvoiceFormSnapshot } | null>(null)
const recognizedRegions = shallowRef<{ invoice: CentralInvoiceRecord, candidate: LocalInvoiceCandidate } | null>(null)
const restoredSnapshot = shallowRef<CentralInvoiceFormSnapshot | null>(null)
const workspaceView = useTemplateRef<InstanceType<typeof CentralInvoiceWorkspaceView>>('workspaceView')
const verificationBusy = shallowRef(false)
const screenRoot = useTemplateRef<HTMLDivElement>('screenRoot')
const batchRegion = useTemplateRef<HTMLElement>('batchRegion')
const sourceRetry = useTemplateRef<HTMLButtonElement>('sourceRetry')
const cachedRecords = shallowRef<CentralInvoiceRecord[]>([])
const missingRecord = shallowRef<CentralInvoiceRecord | null>(null)
let originalGeneration = 0
let recognitionGeneration = 0
let regionGeneration = 0
let uploadAuthorityGeneration = 0
let recognitionProgressGeneration = 0
let formGeneration = 0
let active = true
onBeforeUnmount(() => {
  active = false
  originalGeneration++
  recognitionGeneration++
  regionGeneration++
  recognitionProgressGeneration++
})

async function withRecognitionProgress<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const generation = ++recognitionProgressGeneration
  recognizingId.value = id
  try {
    return await operation()
  }
  finally {
    if (generation === recognitionProgressGeneration)
      recognizingId.value = null
  }
}

/** Vue readonly 代理不直接克隆；逐字段复制保持事实与草稿隔离。 */
const records = computed<CentralInvoiceRecord[]>(() => props.workspace.records.value.map(record => ({
  ...record,
  fields: { ...record.fields },
  items: record.items.map(item => ({ ...item })),
  unrecognizedPageIndexes: [...record.unrecognizedPageIndexes],
  original: record.original ? { ...record.original } : null,
  contract: record.contract ? { ...record.contract } : null,
  legacy: record.legacy ? { ...record.legacy, ambiguousZeroFields: [...record.legacy.ambiguousZeroFields] } : undefined,
})))
watch([records, () => props.workspace.readState.value], ([next, state]) => {
  if (state === 'ready')
    cachedRecords.value = next
}, { immediate: true })
const displayedRecords = computed(() => {
  const current = props.workspace.readState.value === 'ready' ? records.value : cachedRecords.value
  return missingRecord.value && !current.some(record => record.id === missingRecord.value!.id) ? [...current, missingRecord.value] : current
})
const selected = computed(() => displayedRecords.value.find(record => record.id === selectedId.value) ?? null)
watch([() => selected.value?.id, () => selected.value?.original?.id, () => selected.value?.original?.sha256, () => props.workspace.readState.value], () => {
  regionGeneration++
}, { flush: 'sync' })
watch([() => selected.value?.id, () => selected.value?.version, () => selected.value?.original?.id, () => selected.value?.original?.sha256, () => props.workspace.readState.value], () => {
  recognitionGeneration++
  recognizedRegions.value = null
  if (draft.value && (props.workspace.readState.value !== 'ready' || draft.value.invoice.version !== selected.value?.version || !sameOriginal(draft.value.invoice, selected.value))) {
    draft.value = { ...draft.value, candidate: { ...draft.value.candidate, fieldRegions: undefined, regionFrames: undefined } }
  }
}, { flush: 'sync' })
function sameOriginal(left: CentralInvoiceRecord | null | undefined, right: CentralInvoiceRecord | null | undefined) {
  return !!left?.original && !!right?.original && left.id === right.id && left.original.id === right.original.id && left.original.sha256 === right.original.sha256 && left.original.fileSize === right.original.fileSize
}
const regionCandidate = computed(() => {
  if (props.workspace.readState.value !== 'ready' || !originalFile.value || !selected.value)
    return null
  if (draft.value && draft.value.invoice.version === selected.value.version && sameOriginal(draft.value.invoice, selected.value))
    return draft.value.candidate
  if (recognizedRegions.value && recognizedRegions.value.invoice.version === selected.value.version && sameOriginal(recognizedRegions.value.invoice, selected.value))
    return recognizedRegions.value.candidate
  return null
})
function rememberRegions(before: CentralInvoiceRecord, after: CentralInvoiceRecord, candidate: LocalInvoiceCandidate, generation: number) {
  if (active && generation === regionGeneration && props.workspace.readState.value === 'ready' && selected.value?.version === after.version && sameOriginal(before, after) && sameOriginal(after, selected.value))
    recognizedRegions.value = { invoice: after, candidate }
}
const draftRecord = computed<CentralInvoiceRecord | null>(() => {
  const current = draft.value
  if (!current || current.invoice.id !== selectedId.value)
    return null
  const recognized = invoiceCandidateForCommand(current.candidate)
  return { ...current.invoice, fields: recognized.fields, items: recognized.items, unrecognizedPageIndexes: recognized.unrecognizedPageIndexes, reviewStatus: 'unreviewed' }
})

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作暂时不可用，请保留输入后重试。'
}
function refreshPending() {
  try {
    if (props.workspace.readState.value !== 'ready') {
      pending.value = null
      pendingUnavailable.value = true
      return
    }
    if (typeof props.workspace.pendingAll === 'function') {
      const first = props.workspace.pendingAll()[0]
      pending.value = first ? { targetId: first.targetId, action: first.action, ...(first.scopeId !== undefined ? { scopeId: first.scopeId } : {}) } : null
      pendingUnavailable.value = false
      return
    }
    const globalPending = props.workspace.pending(null)
    const selectedPending = selectedId.value ? props.workspace.pending(selectedId.value) : null
    if (globalPending)
      pending.value = { targetId: null, action: globalPending.action }
    else if (selectedId.value && selectedPending)
      pending.value = { targetId: selectedId.value, action: selectedPending.action }
    else pending.value = null
    pendingUnavailable.value = false
  }
  catch {
    pending.value = null
    pendingUnavailable.value = true
    error.value = '无法可靠核对原提交编号，请恢复浏览器存储。'
  }
}
function clearBatch() {
  const hadFocus = typeof document !== 'undefined' && !!batchRegion.value?.contains(document.activeElement)
  batchResults.value = null
  if (hadFocus) {
    void nextTick(() => {
      if (active && document.activeElement === document.body)
        (sourceRetry.value && !sourceRetry.value.disabled ? sourceRetry.value : screenRoot.value)?.focus({ preventScroll: true })
    })
  }
}
watch([() => props.workspace, () => props.workspace.readState.value], ([workspace, state], [previousWorkspace]) => {
  if (workspace !== previousWorkspace || state === 'unavailable' || state === 'unread')
    workspaceView.value?.clearQueueSearch?.()
  uploadAuthorityGeneration++
  recognitionProgressGeneration++
  recognizingId.value = null
  if (batchResults.value) {
    clearBatch()
    error.value = ''
  }
  refreshPending()
}, { flush: 'sync' })
async function mayLeave() {
  if (recognizing.value)
    return false
  if (!dirty.value && !draft.value)
    return true
  return confirm({ variant: 'simple', title: '放弃未保存的发票修改', message: '当前校对或重新识别草稿尚未保存。确定放弃并离开吗？', confirmLabel: '放弃修改' })
}
useTabCloseGuard(mayLeave)
onBeforeRouteLeave(mayLeave)
function leaveContextIsCurrent() {
  const workspace = props.workspace
  const authority = uploadAuthorityGeneration
  const selection = recognitionGeneration
  const form = formGeneration
  const invoiceId = selectedId.value
  const currentDraft = draft.value
  return () => active && props.workspace === workspace && workspace.readState.value === 'ready'
    && uploadAuthorityGeneration === authority && recognitionGeneration === selection && formGeneration === form
    && selectedId.value === invoiceId && draft.value === currentDraft
}
function setDirty(value: boolean) {
  formGeneration++
  dirty.value = value
}
async function choose(id: string) {
  if (id === selectedId.value)
    return
  const isCurrent = leaveContextIsCurrent()
  if (!await mayLeave() || !isCurrent())
    return
  dirty.value = false
  draft.value = null
  restoredSnapshot.value = null
  missingRecord.value = null
  selectedId.value = id
  refreshPending()
}
async function loadOriginal() {
  const current = selected.value
  const workspace = props.workspace
  const generation = ++originalGeneration
  originalFile.value = null
  originalError.value = ''
  if (!active || workspace.readState.value !== 'ready' || !current?.original) {
    originalLoading.value = false
    return
  }
  originalLoading.value = true
  try {
    const blob = await workspace.verifiedOriginal(current)
    if (active && workspace === props.workspace && workspace.readState.value === 'ready' && generation === originalGeneration)
      originalFile.value = new File([blob], current.original.fileName, { type: current.original.mimeType })
  }
  catch (cause) {
    if (active && workspace === props.workspace && workspace.readState.value === 'ready' && generation === originalGeneration)
      originalError.value = message(cause)
  }
  finally {
    if (active && workspace === props.workspace && workspace.readState.value === 'ready' && generation === originalGeneration)
      originalLoading.value = false
  }
}
watch([() => props.workspace, () => selected.value?.id, () => selected.value?.version, () => selected.value?.original?.id, () => selected.value?.original?.sha256, () => selected.value?.original?.fileSize, () => selected.value?.original?.fileName, () => selected.value?.original?.mimeType, () => props.workspace.readState.value], () => {
  originalError.value = ''
  if (props.workspace.readState.value === 'ready') {
    void loadOriginal()
  }
  else {
    originalGeneration++
    originalFile.value = null
    originalLoading.value = false
  }
}, { flush: 'sync' })
async function run(operation: () => Promise<void>, isRelevant: () => boolean = () => true) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    await operation()
  }
  catch (cause) {
    if (isRelevant())
      error.value = message(cause)
  }
  finally {
    busy.value = false
    if (isRelevant())
      refreshPending()
  }
}
async function load() {
  await run(async () => {
    const before = selected.value
    try {
      await props.workspace.load()
    }
    catch (cause) {
      if (cause instanceof CentralInvoiceLoadSupersededError)
        return
      throw cause
    }
    if (selectedId.value && !records.value.some(record => record.id === selectedId.value)) {
      if ((dirty.value || draft.value) && before) {
        missingRecord.value = before
        error.value = '发票已不在当前来源中，未保存的输入仍保留；请复制或放弃后切换。'
      }
      else {
        selectedId.value = null
        missingRecord.value = null
      }
    }
    else {
      missingRecord.value = null
    }
  })
}
onMounted(async () => {
  const beforeLoad = originalGeneration
  await load()
  // 已经有 ready 数据且加载没有触发状态变化时，监听器没有机会启动首次读取。
  if (active && beforeLoad === originalGeneration && props.workspace.readState.value === 'ready')
    void loadOriginal()
  refreshPending()
})
onActivated(() => {
  if (selected.value?.sourceKind === 'excel' && selected.value.accountStatus === 'archived')
    void load()
})
async function upload(files: File[], projectId: string | null) {
  if (!active || uploadPreflight.value || busy.value || props.workspace.readState.value !== 'ready')
    return
  refreshPending()
  if (pending.value || pendingUnavailable.value)
    return
  if (projectId !== null && !props.projects.some(project => project.id === projectId)) {
    error.value = '项目目录已变化，请重新选择上传项目。'
    return
  }
  const workspace = props.workspace
  const authorityGeneration = uploadAuthorityGeneration
  uploadPreflight.value = true
  try {
    if (!await mayLeave())
      return
    if (!active || props.workspace !== workspace || authorityGeneration !== uploadAuthorityGeneration || workspace.readState.value !== 'ready' || busy.value) {
      error.value = '身份或权限已变化，未提交上传，请重新读取。'
      return
    }
    refreshPending()
    if (pending.value || pendingUnavailable.value) {
      error.value = '上次提交尚未可靠核对，不能开始新的上传。'
      return
    }
    if (projectId !== null && !props.projects.some(project => project.id === projectId)) {
      error.value = '项目目录已变化，请重新选择上传项目。'
      return
    }
    draft.value = null
    restoredSnapshot.value = null
    dirty.value = false
    await run(async () => {
      batchResults.value = files.map(file => ({ name: file.name, status: '未处理' }))
      const canContinue = () => {
        if (!active || props.workspace !== workspace || authorityGeneration !== uploadAuthorityGeneration || workspace.readState.value !== 'ready') {
          clearBatch()
          return false
        }
        refreshPending()
        if (pendingUnavailable.value) {
          clearBatch()
          error.value = '无法可靠核对原提交编号，请恢复浏览器存储。'
          return false
        }
        return true
      }
      const setStatus = (index: number, status: string) => {
        if (batchResults.value)
          batchResults.value = batchResults.value.map((item, current) => current === index ? { ...item, status } : item)
      }
      const uploadIsCurrent = () => active && props.workspace === workspace
        && authorityGeneration === uploadAuthorityGeneration && workspace.readState.value === 'ready'
        && (projectId === null || props.projects.some(project => project.id === projectId))
      for (const [index, file] of files.entries()) {
        if (!canContinue() || pending.value)
          break
        setStatus(index, '正在上传')
        let invoice: CentralInvoiceRecord
        try {
          invoice = await workspace.upload(file, projectId, uploadIsCurrent)
        }
        catch (cause) {
          if (canContinue()) {
            setStatus(index, cause instanceof CentralInvoiceUploadNotSubmittedError ? '未提交' : '结果未能确认')
            error.value = message(cause)
          }
          break
        }
        if (!canContinue())
          break
        if (pending.value) {
          setStatus(index, '结果未能确认')
          break
        }
        setStatus(index, '原件已回读，正在识别或核对结果')
        selectedId.value = invoice.id
        try {
          const regionEpoch = regionGeneration
          const result = await withRecognitionProgress(invoice.id, () => workspace.recognizeWithCandidate(invoice))
          if (!canContinue())
            break
          if (pending.value) {
            setStatus(index, '原件已回读，识别未确认')
            break
          }
          rememberRegions(invoice, result.record, result.candidate, regionEpoch)
          setStatus(index, '识别已回读')
        }
        catch (cause) {
          if (!canContinue())
            break
          setStatus(index, pending.value ? '原件已回读，识别未确认' : '原件已回读，识别未完成')
          error.value = message(cause)
          if (pending.value)
            break
        }
      }
    })
  }
  finally {
    uploadPreflight.value = false
  }
}
async function attach(file: File) {
  const current = selected.value
  if (!current || current.original || props.workspace.readState.value !== 'ready')
    return
  const sourceWorkspace = props.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const sourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && sourceWorkspace.readState.value === 'ready'
    && selected.value?.id === current.id && selected.value.version === current.version && !selected.value.original
  if (!await confirm({ variant: 'simple', title: '确认关联原件', message: `请确认所选文件属于发票 ${current.fields.invoiceNumber || current.id}。`, confirmLabel: '确认关联' }))
    return
  if (!sourceIsCurrent()) {
    if (active)
      error.value = '发票或来源已变化，原件关联未提交。'
    return
  }
  await run(async () => {
    await sourceWorkspace.attachOriginal(current, file, true, sourceIsCurrent)
  }, () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && selectedId.value === current.id)
}
async function recognize(source: 'local' | 'cloud') {
  const current = selected.value
  if (!current || draft.value || (dirty.value && current.ocrStatus !== 'done'))
    return
  const sourceWorkspace = props.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const cloudSourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && sourceWorkspace.readState.value === 'ready'
    && selected.value?.id === current.id && selected.value.version === current.version && sameOriginal(current, selected.value)
  if (source === 'cloud' && !props.cloudAvailable) {
    error.value = '云识别尚未启用，请使用本机识别。'
    return
  }
  const consent = source === 'cloud' && await confirm({ variant: 'simple', title: '确认使用云识别', message: '所选发票原件将发送至已配置的云识别服务。', confirmLabel: '确认发送' })
  if (source === 'cloud' && !consent)
    return
  if (source === 'cloud' && !cloudSourceIsCurrent()) {
    if (active)
      error.value = '发票或权限已变化，未保存输入仍保留。'
    return
  }
  if (selected.value?.id !== current.id || selected.value.version !== current.version || props.workspace.readState.value !== 'ready') {
    error.value = '发票或权限已变化，未保存输入仍保留。'
    return
  }
  const before = current.ocrStatus === 'done' ? workspaceView.value?.captureForm() : null
  if (current.ocrStatus === 'done' && (!before || before.invoiceId !== current.id || before.baseVersion !== current.version)) {
    error.value = '发票已变化，未保存输入仍保留，请先核对最新版本。'
    return
  }
  const generation = recognitionGeneration
  recognizing.value = true
  try {
    await run(async () => {
      if (current.ocrStatus !== 'done') {
        const regionEpoch = regionGeneration
        const result = await withRecognitionProgress(current.id, () => source === 'cloud'
          ? sourceWorkspace.recognizeWithCandidate(current, source, consent, cloudSourceIsCurrent)
          : sourceWorkspace.recognizeWithCandidate(current, source, consent))
        rememberRegions(current, result.record, result.candidate, regionEpoch)
        return
      }
      const candidate = await withRecognitionProgress(current.id, () => source === 'cloud'
        ? sourceWorkspace.prepareRerecognition(current, source, consent, cloudSourceIsCurrent)
        : sourceWorkspace.prepareRerecognition(current, source, consent))
      if (!active || generation !== recognitionGeneration || props.workspace.readState.value !== 'ready')
        throw new Error('发票或权限已变化，未保存输入仍保留。')
      const parsed = candidate.fields
      if (candidate.unrecognizedPageIndexes.length || !(parsed.invoiceNumber.trim() || parsed.buyer.trim() || parsed.seller.trim() || parsed.totalAmount !== null || parsed.items.length))
        throw new Error('重新识别未完成，原有字段和原件保持不变。')
      restoredSnapshot.value = null
      draft.value = { workspace: sourceWorkspace, invoice: current, candidate, before: before! }
    })
  }
  finally { recognizing.value = false }
}
function recognitionChangeMessage(before: CentralInvoiceFormSnapshot, fields: CentralInvoiceFields, items: CentralInvoiceItem[]) {
  const normalize = (value: string) => !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : value
  const normalizedFields = { ...before.fields, amount: normalize(before.money.amount), taxAmount: normalize(before.money.taxAmount), totalAmount: normalize(before.money.totalAmount) }
  const normalizedItems = before.items.map(item => ({ ...item, quantity: normalize(item.quantity), unitPrice: normalize(item.unitPrice), amount: normalize(item.amount), taxAmount: normalize(item.taxAmount) }))
  const labels: Record<keyof CentralInvoiceFields, string> = { invoiceNumber: '发票号码', invoiceDate: '开票日期', invoiceType: '发票类型', buyer: '购买方', buyerTaxNo: '购买方税号', seller: '销售方', sellerTaxNo: '销售方税号', amount: '不含税金额', taxAmount: '税额', totalAmount: '价税合计', taxRate: '税率', remark: '备注' }
  const shown = (value: string | number | null) => value === '' || value === null ? '未填写' : String(value)
  const lines = Object.entries(fields).filter(([key, value]) => value !== normalizedFields[key as keyof CentralInvoiceFields]).map(([key, value]) => `${labels[key as keyof CentralInvoiceFields]}：${shown(normalizedFields[key as keyof CentralInvoiceFields])} → ${shown(value)}`)
  if (JSON.stringify(items) !== JSON.stringify(normalizedItems))
    lines.push(`货物明细：${JSON.stringify(before.items)} → ${JSON.stringify(items)}`)
  return lines.length ? lines.join('\n') : '识别结果与原值相同。'
}
function changeMessage(before: CentralInvoiceRecord, fields: CentralInvoiceFields, items: CentralInvoiceItem[]) {
  const labels: Record<keyof CentralInvoiceFields, string> = { invoiceNumber: '发票号码', invoiceDate: '开票日期', invoiceType: '发票类型', buyer: '购买方', buyerTaxNo: '购买方税号', seller: '销售方', sellerTaxNo: '销售方税号', amount: '不含税金额', taxAmount: '税额', totalAmount: '价税合计', taxRate: '税率', remark: '备注' }
  const entries = Object.entries(fields).filter(([key, value]) => value !== before.fields[key as keyof CentralInvoiceFields])
  const lines = entries.map(([key, value]) => `${labels[key as keyof CentralInvoiceFields]}：${before.fields[key as keyof CentralInvoiceFields] ?? '未填写'} → ${value ?? '未填写'}`)
  if (JSON.stringify(items) !== JSON.stringify(before.items))
    lines.push(`货物明细：${JSON.stringify(before.items)} → ${JSON.stringify(items)}`)
  return lines.length ? lines.join('\n') : '识别结果与原值相同。'
}
async function saveRecognition(fields: CentralInvoiceFields, items: CentralInvoiceItem[]) {
  const current = draft.value
  if (!current)
    return
  if (current.workspace !== props.workspace) {
    error.value = '发票来源已变化，识别草稿未提交。'
    return
  }
  const sourceWorkspace = current.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const sourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && sourceWorkspace.readState.value === 'ready'
    && draft.value === current && selected.value?.id === current.invoice.id && selected.value.version === current.invoice.version
    && sameOriginal(current.invoice, selected.value)
  if (!await confirm({ variant: 'simple', title: '确认保存重新识别', message: recognitionChangeMessage(current.before, fields, items), confirmLabel: '确认保存' }))
    return
  if (!sourceIsCurrent()) {
    if (active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration)
      error.value = '发票或权限已变化，识别草稿仍保留，请先核对最新版本。'
    return
  }
  const regionEpoch = regionGeneration
  await run(async () => {
    const saved = await sourceWorkspace.saveRerecognition(current.invoice, current.candidate, fields, items, true, sourceIsCurrent)
    if (!active || props.workspace !== sourceWorkspace || sourceGeneration !== uploadAuthorityGeneration || selectedId.value !== current.invoice.id
      || draft.value?.invoice !== current.invoice || draft.value?.before !== current.before) {
      return
    }
    rememberRegions(current.invoice, saved, current.candidate, regionEpoch)
    draft.value = null
    restoredSnapshot.value = null
    dirty.value = false
  }, () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedId.value === current.invoice.id && draft.value?.before === current.before)
}
async function discardRecognition() {
  const current = draft.value
  const isCurrent = leaveContextIsCurrent()
  if (!current || !await mayLeave() || !isCurrent())
    return
  restoredSnapshot.value = current.before
  draft.value = null
  dirty.value = current.before.dirty
}
async function save(payload: { invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[] }) {
  const current = selected.value
  if (!current || payload.invoiceId !== current.id || payload.baseVersion !== current.version) {
    error.value = '发票已变化，当前输入仍保留，请先核对最新版本。'
    return
  }
  if (draft.value)
    return saveRecognition(payload.fields, payload.items)
  if (current.accountStatus === 'archived' && !await confirm({ variant: 'simple', title: '确认更正已归档发票', message: changeMessage(current, payload.fields, payload.items), confirmLabel: '确认更正' }))
    return
  restoredSnapshot.value = null
  if (current.accountStatus === 'archived') {
    await run(async () => {
      await props.workspace.editArchived(current, payload.fields, payload.items, true)
    })
    return
  }
  const sourceWorkspace = props.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const currentFormGeneration = formGeneration
  const sourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && currentFormGeneration === formGeneration && sourceWorkspace.readState.value === 'ready'
    && selected.value?.id === current.id && selected.value.version === current.version && !draft.value && !missingRecord.value
  const resultIsRelevant = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration && selectedId.value === current.id
  let blockedBeforeSubmit = false
  await run(async () => {
    await sourceWorkspace.edit(current, payload.fields, payload.items, () => {
      const allowed = sourceIsCurrent()
      blockedBeforeSubmit = !allowed
      return allowed
    })
  }, resultIsRelevant)
  if (active && !resultIsRelevant()) {
    refreshPending()
    if (blockedBeforeSubmit && !pendingUnavailable.value && props.workspace === sourceWorkspace && sourceWorkspace.readState.value === 'ready' && selectedId.value === current.id)
      error.value = '发票或来源已变化，保存未提交；请核对后重试。'
  }
}
async function review(manualCompletion: boolean) {
  const current = selected.value
  if (!current || dirty.value || draft.value || missingRecord.value)
    return
  const sourceWorkspace = props.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const currentFormGeneration = formGeneration
  const sourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && currentFormGeneration === formGeneration && sourceWorkspace.readState.value === 'ready'
    && selected.value?.id === current.id && selected.value.version === current.version && !dirty.value && !draft.value && !missingRecord.value
  const resultIsRelevant = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration && selectedId.value === current.id
  let blockedBeforeSubmit = false
  await run(async () => {
    await sourceWorkspace.review(current, manualCompletion, () => {
      const allowed = sourceIsCurrent()
      blockedBeforeSubmit = !allowed
      return allowed
    })
  }, resultIsRelevant)
  if (active && !resultIsRelevant()) {
    refreshPending()
    if (blockedBeforeSubmit && !pendingUnavailable.value && props.workspace === sourceWorkspace && sourceWorkspace.readState.value === 'ready' && selectedId.value === current.id)
      error.value = '发票或来源已变化，核对未提交；请核对后重试。'
  }
}
async function archive(attribution: { ownerKind: 'project' | 'personal' | 'company', projectId: string | null, supplierId: string, taxVerification: InvoiceTaxVerificationSelection, contract?: InvoiceContractReference | null }) {
  const current = selected.value
  if (!current || dirty.value || draft.value)
    return
  const sourceWorkspace = props.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const sourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && sourceWorkspace.readState.value === 'ready'
    && selected.value?.id === current.id && selected.value.version === current.version && !dirty.value && !draft.value
    && props.signatories.some(item => item.id === attribution.taxVerification.buyerId && item.version === attribution.taxVerification.buyerVersion)
    && props.suppliers.some(item => item.id === attribution.supplierId && item.version === attribution.taxVerification.supplierVersion)
    && (attribution.ownerKind !== 'project' || props.projects.some(item => item.id === attribution.projectId))
    && (!attribution.contract || (props.contracts ?? []).some(item => item.domain === attribution.contract!.domain && item.id === attribution.contract!.id && item.version === attribution.contract!.version))
  if (!await confirm({ variant: 'simple', title: '确认核对购销双方税号', message: `请对照发票原件和真实主体资料核对税号。\n购买方：${current.fields.buyerTaxNo}\n销售方：${current.fields.sellerTaxNo}\n确认两项均已核对后归档。`, confirmLabel: '已核对并归档' }))
    return
  if (!sourceIsCurrent()) {
    if (active)
      error.value = '发票或归档来源已变化，归档操作未提交。'
    return
  }
  await run(async () => {
    await sourceWorkspace.archive(current, attribution.ownerKind, attribution.projectId, attribution.supplierId, true, attribution.taxVerification, attribution.contract, sourceIsCurrent)
  })
}
async function linkContract(contract: InvoiceContractReference | null) {
  const current = selected.value
  if (!current || dirty.value || draft.value || missingRecord.value)
    return
  const message = contract ? `请确认所选合同 ${contract.id} 属于当前发票。` : '确定解除这张发票的合同关联吗？'
  if (!await confirm({ variant: 'simple', title: '确认合同关联', message, confirmLabel: '确认' }))
    return
  await run(async () => {
    await props.workspace.linkContract(current, contract, true)
  })
}
async function confirmLegacy() {
  const current = selected.value
  if (!current || dirty.value || draft.value || missingRecord.value)
    return
  const sourceWorkspace = props.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const sourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && sourceWorkspace.readState.value === 'ready'
    && selected.value?.id === current.id && selected.value.version === current.version && !dirty.value && !draft.value && !missingRecord.value
  if (!await confirm({ variant: 'simple', title: '核对旧发票', message: '请确认已核对票号、日期、销售方、金额和归属。确认后可用于新增付款，历史付款依据保持不变。', confirmLabel: '确认已核对' }))
    return
  if (!sourceIsCurrent()) {
    if (active)
      error.value = '发票或来源已变化，旧发票核对未提交。'
    return
  }
  await run(async () => {
    await sourceWorkspace.confirmLegacy(current, true, sourceIsCurrent)
  }, () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && selectedId.value === current.id)
}
async function discard() {
  const current = selected.value
  if (!current || dirty.value || draft.value)
    return
  const sourceWorkspace = props.workspace
  const sourceGeneration = uploadAuthorityGeneration
  const selectedGeneration = recognitionGeneration
  const sourceIsCurrent = () => active && props.workspace === sourceWorkspace && sourceGeneration === uploadAuthorityGeneration
    && selectedGeneration === recognitionGeneration && sourceWorkspace.readState.value === 'ready'
    && selected.value?.id === current.id && selected.value.version === current.version && !dirty.value && !draft.value
  if (!await confirm({ variant: 'simple', title: '废弃发票', message: `确定废弃 ${current.fields.invoiceNumber || current.id} 吗？`, confirmLabel: '废弃' }))
    return
  if (!sourceIsCurrent()) {
    if (active)
      error.value = '发票或权限已变化，废弃操作未提交。'
    return
  }
  await run(async () => {
    const removed = await sourceWorkspace.discard(current, sourceIsCurrent)
    if (!active || props.workspace !== sourceWorkspace || sourceGeneration !== uploadAuthorityGeneration || selectedId.value !== current.id)
      return
    selectedId.value = null
    undoToast('发票已废弃', async () => {
      await sourceWorkspace.restore(removed)
    })
  })
}
async function recover() {
  if (!pending.value || pending.value.scopeId !== undefined)
    return
  const targetId = pending.value.targetId
  const action = pending.value.action
  await run(async () => {
    const result = await props.workspace.recover(targetId)
    if (result?.outcome === 'applied') {
      selectedId.value = result.read.record.id
      if (action === 'rerecognize' && draft.value?.invoice.id === targetId) {
        draft.value = null
        restoredSnapshot.value = null
        dirty.value = false
      }
    }
  })
}
</script>

<template>
  <div ref="screenRoot" tabindex="-1" class="flex h-full min-h-0 flex-col">
    <div v-if="workspace.readState.value !== 'ready'" class="flex flex-wrap items-center gap-2 p-3" role="status">
      <span>{{ workspace.loading.value ? '正在读取中央发票…' : '发票来源尚不可用。' }}</span>
      <button ref="sourceRetry" type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="load">
        重新读取
      </button>
    </div>
    <div v-if="pending" class="flex flex-wrap items-center gap-2 p-3" role="status">
      <span>上次提交结果尚未核对，不能换编号重复提交。</span>
      <NuxtLink v-if="pending.scopeId !== undefined && pending.targetId" :to="`/finance/invoice/correction/${encodeURIComponent(pending.targetId)}`" class="rounded border border-line px-3 py-1">
        前往更正单核对原提交
      </NuxtLink>
      <button v-else type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="recover">
        核对上次提交
      </button>
    </div>
    <section v-if="batchResults" ref="batchRegion" tabindex="0" aria-label="本次上传结果" class="max-h-48 shrink-0 overflow-auto border-b border-line p-3 text-sm">
      <h2 class="font-medium">
        本次上传结果
      </h2>
      <p v-if="batchResults.some(item => item.status === '结果未能确认' || item.status === '原件已回读，识别未确认')">
        请先核对上次提交；未显示待核对编号时，请重新读取发票列表并人工核对后再决定是否重新选择文件。
      </p>
      <ul aria-live="polite">
        <li v-for="(item, index) in batchResults" :key="index" class="break-all">
          {{ item.name }}：{{ item.status }}
        </li>
      </ul>
    </section>
    <CentralInvoiceWorkspaceView v-show="workspace.readState.value === 'ready'" ref="workspaceView" class="min-h-0 flex-1" :records="displayedRecords" :selected-id="selectedId" :original-file="originalFile" :original-loading="originalLoading" :recognizing-id="recognizingId" :busy="busy || uploadPreflight || verificationBusy || !!pending || pendingUnavailable" :selection-unavailable="!!missingRecord" :source-available="workspace.readState.value === 'ready'" :cloud-available="!!cloudAvailable" :projects="projects" :suppliers="suppliers" :signatories="signatories" :contracts="contracts" :draft-record="draftRecord" :recognition-baseline="draft?.before" :region-candidate="regionCandidate" :restored-snapshot="restoredSnapshot" :error="error || originalError" @select="choose" @upload="upload" @manual="navigateTo('/finance/invoice/manual-new')" @attach="attach" @save="save" @review="review" @archive="archive" @discard="discard" @link-contract="linkContract" @confirm-legacy="confirmLegacy" @recognize="recognize" @retry-original="loadOriginal" @dirty="setDirty" @save-recognition="draftRecord && saveRecognition(draftRecord.fields, draftRecord.items)" @discard-recognition="discardRecognition">
      <template #original-verification>
        <CentralInvoiceOriginalVerification
          v-if="workspace.readState.value === 'ready' && !missingRecord && selected?.sourceKind === 'excel' && selected.accountStatus === 'archived' && selected.original"
          :key="selected.id"
          :invoice="selected"
          :workspace="workspace"
          :original-visible="!!originalFile"
          :disabled="busy || uploadPreflight || !!pending || pendingUnavailable"
          :cloud-available="cloudAvailable"
          @busy="verificationBusy = $event"
          @settled="refreshPending"
        />
      </template>
    </CentralInvoiceWorkspaceView>
    <p v-if="workspace.readState.value !== 'ready' && error" role="alert" class="p-3 text-sm text-danger">
      {{ error }}
    </p>
  </div>
</template>
