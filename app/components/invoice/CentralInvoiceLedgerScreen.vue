<script setup lang="ts">
import type { CentralInvoicePrintCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import type { InvoiceLedgerExportRow, InvoiceXlsxStyleConfig } from '~/lib/invoice/excel'
import type { InvoicePrintRequest, InvoicePrintViewModel } from '~/lib/invoice/print-layout'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useKitUI } from '~/composables/useKitUI'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { centralInvoicePrintReason } from '~/lib/invoice/central-print'
import { centralInvoiceSourceLabel } from '~/lib/invoice/central-source-label'
import { createInvoiceLedgerXlsxFromRows, INVOICE_XLSX_MIME, invoiceLedgerTotal } from '~/lib/invoice/excel'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import CentralInvoiceLedgerView from './CentralInvoiceLedgerView.vue'
import InvoiceExportPreview from './InvoiceExportPreview.vue'
import InvoicePrintLayout from './InvoicePrintLayout.vue'

type Workspace = ReturnType<typeof createCentralInvoiceWorkspace>
interface ReferenceOption { id: string, label: string, sourceVersion?: string }
const props = withDefaults(defineProps<{ workspace: Workspace, projects: readonly ReferenceOption[], projectsReadable?: boolean, verifyProjects?: () => Promise<readonly ReferenceOption[]> }>(), { projectsReadable: true })
const emit = defineEmits<{ open: [id: string] }>()
const { confirm, exportFile, undoToast } = useKitUI()
const busy = shallowRef(false)
const error = shallowRef('')
const printMode = shallowRef(false)
const printSelectedId = shallowRef<string | null>(null)
const printSource = shallowRef<CentralInvoiceRecord[]>([])
const originalFailures = shallowRef<Record<string, string>>({})
const pendingPrint = shallowRef<InvoicePrintRequest | null>(null)
const printTargets = shallowRef<CentralInvoicePrintCommand['targets']>([])
let active = true
onBeforeUnmount(() => {
  active = false
  clearConfirmationFocus()
})
const recoveryPending = shallowRef(false)
const recoveryReadError = shallowRef(false)
const printAuthorized = shallowRef(false)
const errorRef = useTemplateRef<HTMLElement>('errorRef')
const rootRef = useTemplateRef<HTMLElement>('rootRef')
let authorityGeneration = 0
let focusMedia: MediaQueryList | null = null
const exportOpen = shallowRef(false)
const exportSaving = shallowRef(false)
const exportError = shallowRef('')
const exportRows = shallowRef<InvoiceLedgerExportRow[]>([])
const exportVersions = shallowRef<Array<{ id: string, version: string }>>([])
const exportProjects = shallowRef<Array<{ id: string, label: string, sourceVersion: string }> | null>([])
const exportName = shallowRef('')
const readableProjects = computed(() => props.projectsReadable ? props.projects : [])
const exportTotal = computed(() => invoiceLedgerTotal(exportRows.value))
const cachedRecords = shallowRef<CentralInvoiceRecord[]>([])
function expireExport(reason: string) {
  exportOpen.value = false
  exportRows.value = []
  exportVersions.value = []
  exportProjects.value = []
  error.value = reason
  const generation = authorityGeneration
  void nextTick(() => {
    if (active && generation === authorityGeneration)
      errorRef.value?.focus()
  })
}
watch([() => props.projectsReadable, () => props.projects], ([readable, projects]) => {
  const snapshot = exportProjects.value
  if (!exportOpen.value || !snapshot?.length)
    return
  if (!readable || snapshot.some(expected => !projects.some(project => project.id === expected.id && project.label === expected.label && project.sourceVersion === expected.sourceVersion)))
    expireExport('项目目录已变化或不可读，请重新读取并打开预览。')
}, { flush: 'sync' })
function invalidatePresentation() {
  authorityGeneration++
  clearConfirmationFocus()
  cachedRecords.value = []
  printSource.value = []
  printSelectedId.value = null
  originalFailures.value = {}
  pendingPrint.value = null
  printTargets.value = []
  printAuthorized.value = false
  printMode.value = false
  exportOpen.value = false
  exportRows.value = []
  exportVersions.value = []
  exportProjects.value = []
  recoveryPending.value = false
  recoveryReadError.value = false
  error.value = '发票来源或权限已变化，请重新读取。'
  const generation = authorityGeneration
  void nextTick(() => {
    if (active && generation === authorityGeneration)
      errorRef.value?.focus()
  })
}
watch(() => props.workspace, (next, previous) => {
  if (next !== previous)
    invalidatePresentation()
}, { flush: 'sync' })
watch(() => props.workspace.readState.value, (state) => {
  if (state === 'unavailable')
    invalidatePresentation()
}, { flush: 'sync' })
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
const displayedRecords = computed(() => props.workspace.readState.value === 'ready' ? records.value : cachedRecords.value)
const printSkipped = computed(() => printSource.value.flatMap((record) => {
  const reason = centralInvoicePrintReason(record) ?? originalFailures.value[record.id]
  return reason ? [{ record, reason }] : []
}))
const printModels = computed<InvoicePrintViewModel[]>(() => printSource.value.filter(record => !centralInvoicePrintReason(record) && !originalFailures.value[record.id]).map(record => ({
  id: record.id,
  fileName: record.original?.fileName ?? '',
  invoiceNumber: record.fields.invoiceNumber,
  invoiceType: record.fields.invoiceType,
  buyer: record.fields.buyer,
  seller: record.fields.seller,
  remark: record.fields.remark,
  totalAmount: record.fields.totalAmount!,
  printRotation: record.printRotation,
  printCount: record.printCount,
  ocrStatus: record.ocrStatus,
  reviewStatus: record.reviewStatus,
  dupStatus: record.duplicateStatus,
  source: record.sourceKind,
})))
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作暂时不可用，请稍后重试。'
}
function sourceUnavailable() {
  return props.workspace.readState.value === 'unavailable'
}
function refreshPending() {
  if (props.workspace.readState.value !== 'ready')
    return false
  try {
    const wasUnreadable = recoveryReadError.value
    recoveryPending.value = !!props.workspace.pendingPrint()
    recoveryReadError.value = false
    if (wasUnreadable && error.value === '打印记录存储暂不可核验，请重试核对。')
      error.value = ''
  }
  catch {
    recoveryPending.value = true
    recoveryReadError.value = true
    error.value = '打印记录存储暂不可核验，请重试核对。'
  }
  return !recoveryPending.value
}
function clearConfirmationFocus() {
  focusMedia?.removeEventListener('change', onPrintMediaChange)
  focusMedia = null
}
function onPrintMediaChange() {
  if (!focusMedia || focusMedia.matches)
    return
  const generation = authorityGeneration
  clearConfirmationFocus()
  void nextTick(() => {
    if (generation === authorityGeneration)
      focusPrintConfirmation()
  })
}
function focusPrintConfirmation() {
  clearConfirmationFocus()
  if (!active || busy.value || !pendingPrint.value || !printMode.value || props.workspace.readState.value !== 'ready')
    return
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null
  if (media?.matches) {
    focusMedia = media
    media.addEventListener('change', onPrintMediaChange)
    if (!media.matches)
      onPrintMediaChange()
    return
  }
  rootRef.value?.querySelector<HTMLButtonElement>('button[aria-label="已打印"]')?.focus()
}
async function mayLeave() {
  if (printMode.value && busy.value)
    return false
  if (!pendingPrint.value)
    return true
  return confirm({ variant: 'simple', title: '离开打印排版', message: '本次打印尚未确认记录。确定离开吗？', confirmLabel: '离开' })
}
useTabCloseGuard(mayLeave)
onBeforeRouteLeave(mayLeave)
async function run(operation: () => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  const generation = authorityGeneration
  try {
    await operation()
  }
  catch (cause) {
    if (generation === authorityGeneration)
      error.value = message(cause)
  }
  finally {
    busy.value = false
    if (generation === authorityGeneration) {
      refreshPending()
      await nextTick()
      if (error.value)
        errorRef.value?.focus()
      else if (pendingPrint.value && printMode.value && props.workspace.readState.value === 'ready')
        focusPrintConfirmation()
    }
  }
}
async function load() {
  await run(() => props.workspace.load())
}
onMounted(async () => {
  await load()
  refreshPending()
})
function preparePrint(selected: CentralInvoiceRecord[]) {
  if (busy.value || recoveryPending.value || exportOpen.value || !selected.length || props.workspace.readState.value !== 'ready')
    return
  printSource.value = selected.map(record => ({ ...record, fields: { ...record.fields }, items: record.items.map(item => ({ ...item })) }))
  originalFailures.value = {}
  printSelectedId.value = selected.find(record => !centralInvoicePrintReason(record))?.id ?? null
  pendingPrint.value = null
  printTargets.value = []
  printMode.value = true
}
function prepareExport(rows: CentralInvoiceRecord[]) {
  if (busy.value || !rows.length || props.workspace.readState.value !== 'ready')
    return
  exportRows.value = rows.map(record => ({
    invoiceDate: record.fields.invoiceDate,
    invoiceNumber: record.fields.invoiceNumber,
    seller: record.fields.seller,
    invoiceType: record.fields.invoiceType,
    totalAmount: record.fields.totalAmount,
    projectName: record.ownerKind === 'personal' ? '个人开支' : record.ownerKind === 'company' ? '公司开销' : record.ownerKind === null ? '未归属' : !record.projectId ? '项目身份待核实' : readableProjects.value.find(project => project.id === record.projectId)?.label ?? '项目来源不可用',
    source: centralInvoiceSourceLabel(record),
    remark: record.fields.remark,
  }))
  exportVersions.value = rows.map(record => ({ id: record.id, version: record.version }))
  const projectIds = [...new Set(rows.flatMap(record => record.ownerKind === 'project' && record.projectId ? [record.projectId] : []))]
  const selectedProjects = projectIds.map(id => readableProjects.value.find(project => project.id === id))
  exportProjects.value = rows.every(record => record.ownerKind !== 'project' || !!record.projectId) && selectedProjects.every(project => !!project?.sourceVersion)
    ? selectedProjects.map(project => ({ id: project!.id, label: project!.label, sourceVersion: project!.sourceVersion! }))
    : null
  exportError.value = ''
  exportName.value = `发票台账_${toLocalDateInputValue()}.xlsx`
  exportOpen.value = true
}
async function confirmExport(style: InvoiceXlsxStyleConfig) {
  if (exportSaving.value || !exportRows.value.length || props.workspace.readState.value !== 'ready')
    return
  const sourceWorkspace = props.workspace
  const generation = authorityGeneration
  const rows = exportRows.value
  const versions = exportVersions.value
  const projects = exportProjects.value
  const verifyProjects = props.verifyProjects
  const currentSession = () => active && exportOpen.value && generation === authorityGeneration && props.workspace === sourceWorkspace
    && sourceWorkspace.readState.value === 'ready' && exportRows.value === rows && exportVersions.value === versions
    && exportProjects.value === projects && rows.length > 0 && versions.length === rows.length
  exportSaving.value = true
  exportError.value = ''
  let projectReadFailed = false
  let previewStale = false
  try {
    await sourceWorkspace.load()
    if (!currentSession())
      return
    if (versions.some(item => !sourceWorkspace.records.value.some(record => record.id === item.id && record.version === item.version && record.accountStatus === 'archived' && record.deletedAt === null))) {
      previewStale = true
      throw new Error('导出预览中的发票已变化，请关闭预览并重新选择。')
    }
    if (projects === null || (projects.length && !verifyProjects))
      throw new Error('项目目录尚未可靠读取，不能导出项目名称。')
    if (projects.length) {
      const currentProjects = await verifyProjects!().catch((cause) => {
        projectReadFailed = true
        throw cause
      })
      if (!currentSession())
        return
      if (projects.some(expected => !currentProjects.some(project => project.id === expected.id && project.label === expected.label && project.sourceVersion === expected.sourceVersion))) {
        previewStale = true
        throw new Error('项目目录已变化，请关闭预览并重新读取。')
      }
    }
    if (!currentSession())
      return
    await exportFile({ data: createInvoiceLedgerXlsxFromRows(rows, style), defaultName: exportName.value, mimeType: INVOICE_XLSX_MIME })
    if (currentSession())
      exportOpen.value = false
  }
  catch (cause) {
    if (!currentSession())
      return
    exportError.value = message(cause)
    if (sourceUnavailable() || projectReadFailed || previewStale) {
      expireExport(exportError.value)
    }
  }
  finally { exportSaving.value = false }
}
async function print(payload: InvoicePrintRequest) {
  if (busy.value || pendingPrint.value || recoveryPending.value || !printMode.value || props.workspace.readState.value !== 'ready')
    return
  if (!refreshPending())
    return
  const sourceWorkspace = props.workspace
  const generation = authorityGeneration
  const currentSession = () => active && printMode.value && generation === authorityGeneration && props.workspace === sourceWorkspace
  await run(async () => {
    if (!payload.ids.length || new Set(payload.ids).size !== payload.ids.length)
      throw new Error('打印票据身份无效，请重新选择。')
    await sourceWorkspace.load()
    if (!currentSession())
      return
    if (props.workspace.readState.value !== 'ready')
      throw new Error('发票来源尚不可用，请重新读取。')
    const validatedTargets = (): CentralInvoicePrintCommand['targets'] => payload.ids.map((id) => {
      const source = printSource.value.find(record => record.id === id)
      const current = records.value.find(record => record.id === id)
      const rotation = payload.rotations[id]
      if (!source || !current || current.version !== source.version || centralInvoicePrintReason(source) || centralInvoicePrintReason(current) || originalFailures.value[id] || rotation === undefined)
        throw new Error('打印票据已变化或不再满足打印条件，请返回台账重新选择。')
      return { invoiceId: id, baseVersion: source.version, rotation }
    })
    validatedTargets()
    for (const id of payload.ids) {
      const record = records.value.find(item => item.id === id)!
      try {
        await sourceWorkspace.verifiedOriginal(record, true)
      }
      catch {
        if (!currentSession())
          return
        originalFailures.value = { ...originalFailures.value, [id]: '原件读取或核验未完成，请确认访问权限后重试' }
        throw new Error(`发票 ${record.fields.invoiceNumber || record.id} 的原件读取或核验失败，不能打印。`)
      }
      if (!currentSession())
        return
    }
    await sourceWorkspace.load()
    if (!currentSession())
      return
    if (props.workspace.readState.value !== 'ready')
      throw new Error('发票来源尚不可用，请重新读取。')
    const targets = validatedTargets()
    if (!refreshPending())
      return
    printAuthorized.value = true
    await nextTick()
    if (!currentSession() || props.workspace.readState.value !== 'ready') {
      printAuthorized.value = false
      return
    }
    let completed = false
    const afterPrint = () => {
      completed = true
    }
    window.addEventListener('afterprint', afterPrint, { once: true })
    try {
      window.print()
    }
    catch {
      error.value = '系统打印窗口打开失败，请重试。'
      return
    }
    finally {
      printAuthorized.value = false
      window.removeEventListener('afterprint', afterPrint)
    }
    if (!currentSession() || props.workspace.readState.value !== 'ready')
      return
    if (!completed)
      throw new Error('无法确认系统打印窗口是否结束，纸张可能已经输出，请先人工核对后再操作。')
    pendingPrint.value = payload
    printTargets.value = targets
  })
}
function retryOriginal(id: string) {
  const next = { ...originalFailures.value }
  delete next[id]
  originalFailures.value = next
  error.value = ''
}
async function cancelPrint() {
  clearConfirmationFocus()
  pendingPrint.value = null
  printTargets.value = []
  await nextTick()
  const buttons = rootRef.value?.querySelectorAll<HTMLButtonElement>('button') ?? []
  Array.from(buttons).find(button => button.textContent?.trim() === '打印选中')?.focus()
}
async function confirmPrinted() {
  if (!pendingPrint.value || !printTargets.value.length || recoveryPending.value || props.workspace.readState.value !== 'ready')
    return
  await run(async () => {
    await props.workspace.recordPrinted(printTargets.value)
    clearConfirmationFocus()
    pendingPrint.value = null
    printTargets.value = []
  })
}
async function recoverPrint() {
  await run(async () => {
    const result = await props.workspace.recoverPrint()
    if (result?.outcome === 'applied') {
      pendingPrint.value = null
      printTargets.value = []
    }
  })
}
async function leavePrint() {
  if (!await mayLeave())
    return
  clearConfirmationFocus()
  pendingPrint.value = null
  printTargets.value = []
  printMode.value = false
}
async function discard(id: string) {
  const record = records.value.find(item => item.id === id)
  if (!record || !await confirm({ variant: 'simple', title: '删除发票', message: `确定删除 ${record.fields.invoiceNumber || record.id} 吗？`, confirmLabel: '删除' }))
    return
  await run(async () => {
    const removed = await props.workspace.discard(record)
    undoToast('发票已删除', async () => {
      await props.workspace.restore(removed)
    })
  })
}
</script>

<template>
  <div ref="rootRef" class="flex h-full min-h-0 flex-col">
    <div v-if="workspace.readState.value !== 'ready'" role="status" class="flex flex-wrap items-center gap-2 p-3 print:hidden">
      <span>{{ workspace.loading.value ? '正在读取发票台账…' : '发票来源尚不可用。' }}</span>
      <button type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="load">
        重新读取
      </button>
    </div>
    <div v-if="recoveryPending" role="status" class="flex flex-wrap items-center gap-2 p-3 print:hidden">
      <span>{{ recoveryReadError ? '打印记录存储暂不可核验，不能开始打印。' : '上次打印记录尚未核对，不能重复提交。' }}</span>
      <button type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="recoveryReadError ? refreshPending() : recoverPrint()">
        {{ recoveryReadError ? '重新核验打印记录' : '核对打印记录' }}
      </button>
    </div>
    <p v-if="error" ref="errorRef" role="alert" tabindex="-1" class="p-3 text-sm text-danger print:hidden">
      {{ error }}
    </p>
    <p v-if="printMode && busy && workspace.readState.value === 'ready'" role="status" class="p-3 text-sm text-ink-soft print:hidden">
      正在处理打印，请稍候。
    </p>
    <CentralInvoiceLedgerView v-show="workspace.readState.value === 'ready' && !printMode" class="min-h-0 flex-1 print:hidden" :records="displayedRecords" :projects="readableProjects" :projects-readable="projectsReadable" :busy="busy || recoveryPending" @open="emit('open', $event)" @discard="discard" @prepare-print="preparePrint" @export="prepareExport" />
    <div v-if="printMode" v-show="workspace.readState.value === 'ready'" :class="{ 'central-print-unverified': !printAuthorized }" :inert="busy" :aria-busy="busy" class="min-h-0 flex-1 overflow-auto print:overflow-visible">
      <section v-if="printSkipped.length" aria-label="不能打印的发票" class="mb-3 rounded border border-warn/35 bg-warn-soft p-3 text-sm text-warn-ink print:hidden">
        <p role="status">
          {{ `${printSkipped.length} 张发票不会打印；确认后只登记实际打印的发票。` }}
        </p>
        <ul class="mt-2 max-h-40 overflow-auto">
          <li v-for="item in printSkipped" :key="item.record.id" class="flex items-start gap-2 py-1">
            <input type="checkbox" disabled :aria-label="`勾选发票 ${item.record.fields.invoiceNumber || item.record.id}`">
            <span>{{ item.record.fields.invoiceNumber || item.record.id }}：{{ item.reason }}<template v-if="item.record.fields.totalAmount === null">（金额未填写）</template></span>
            <button v-if="originalFailures[item.record.id]" type="button" class="text-brand underline" @click="retryOriginal(item.record.id)">
              {{ '重新核验' }}
            </button>
          </li>
        </ul>
      </section>
      <InvoicePrintLayout v-model:selected-id="printSelectedId" :invoices="printModels" :print-confirmation="pendingPrint" full-page @print="print" @confirm-print="confirmPrinted" @cancel-print="cancelPrint" @back="leavePrint" />
    </div>
    <InvoiceExportPreview v-if="exportOpen" v-model:open="exportOpen" :rows="exportRows" :total-amount="exportTotal" :file-name="exportName" :saving="exportSaving" :error="exportError" @confirm="confirmExport" />
  </div>
</template>

<style scoped>
@media print {
  .central-print-unverified :deep(.invoice-print-output) {
    display: none !important;
  }
}
</style>
