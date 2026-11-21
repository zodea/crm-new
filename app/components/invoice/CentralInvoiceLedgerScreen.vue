<script setup lang="ts">
import type { CentralInvoicePrintCommand, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import type { InvoiceLedgerExportRow, InvoiceXlsxStyleConfig } from '~/lib/invoice/excel'
import type { InvoicePrintRequest, InvoicePrintViewModel } from '~/lib/invoice/print-layout'
import { computed, nextTick, onMounted, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useKitUI } from '~/composables/useKitUI'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { centralInvoiceSourceLabel } from '~/lib/invoice/central-source-label'
import { createInvoiceLedgerXlsxFromRows, INVOICE_XLSX_MIME, invoiceLedgerTotal } from '~/lib/invoice/excel'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import CentralInvoiceLedgerView from './CentralInvoiceLedgerView.vue'
import InvoiceExportPreview from './InvoiceExportPreview.vue'
import InvoicePrintLayout from './InvoicePrintLayout.vue'

type Workspace = ReturnType<typeof createCentralInvoiceWorkspace>
interface ReferenceOption { id: string, label: string, sourceVersion?: string }
const props = defineProps<{ workspace: Workspace, projects: readonly ReferenceOption[], verifyProjects?: () => Promise<readonly ReferenceOption[]> }>()
const emit = defineEmits<{ open: [id: string] }>()
const { confirm, exportFile, undoToast } = useKitUI()
const busy = shallowRef(false)
const error = shallowRef('')
const printMode = shallowRef(false)
const printSelectedId = shallowRef<string | null>(null)
const printSource = shallowRef<CentralInvoiceRecord[]>([])
const pendingPrint = shallowRef<InvoicePrintRequest | null>(null)
const printTargets = shallowRef<CentralInvoicePrintCommand['targets']>([])
const recoveryPending = shallowRef(false)
const exportOpen = shallowRef(false)
const exportSaving = shallowRef(false)
const exportError = shallowRef('')
const exportRows = shallowRef<InvoiceLedgerExportRow[]>([])
const exportVersions = shallowRef<Array<{ id: string, version: string }>>([])
const exportProjects = shallowRef<Array<{ id: string, label: string, sourceVersion: string }> | null>([])
const exportName = shallowRef('')
const exportTotal = computed(() => invoiceLedgerTotal(exportRows.value))
const cachedRecords = shallowRef<CentralInvoiceRecord[]>([])
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
const printModels = computed<InvoicePrintViewModel[]>(() => printSource.value.map(record => ({
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
  original: record.original,
})))
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作暂时不可用，请稍后重试。'
}
function sourceUnavailable() {
  return props.workspace.readState.value === 'unavailable'
}
function refreshPending() {
  try {
    recoveryPending.value = !!props.workspace.pendingPrint()
  }
  catch (cause) { error.value = message(cause) }
}
async function mayLeave() {
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
  try {
    await operation()
  }
  catch (cause) { error.value = message(cause) }
  finally {
    busy.value = false
    refreshPending()
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
  if (busy.value || recoveryPending.value || !selected.length || selected.some(record => record.fields.totalAmount === null))
    return
  printSource.value = selected.map(record => ({ ...record, fields: { ...record.fields }, items: record.items.map(item => ({ ...item })) }))
  printSelectedId.value = selected[0]!.id
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
    projectName: record.ownerKind === 'personal' ? '个人开支' : record.ownerKind === 'company' ? '公司开销' : props.projects.find(project => project.id === record.projectId)?.label ?? '项目来源不可用',
    source: centralInvoiceSourceLabel(record),
    remark: record.fields.remark,
  }))
  exportVersions.value = rows.map(record => ({ id: record.id, version: record.version }))
  const projectIds = [...new Set(rows.flatMap(record => record.ownerKind === 'project' && record.projectId ? [record.projectId] : []))]
  const selectedProjects = projectIds.map(id => props.projects.find(project => project.id === id))
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
  exportSaving.value = true
  exportError.value = ''
  let projectReadFailed = false
  try {
    await props.workspace.load()
    if (exportVersions.value.some(item => !props.workspace.records.value.some(record => record.id === item.id && record.version === item.version && record.accountStatus === 'archived' && record.deletedAt === null)))
      throw new Error('导出预览中的发票已变化，请关闭预览并重新选择。')
    if (exportProjects.value === null || (exportProjects.value.length && !props.verifyProjects))
      throw new Error('项目目录尚未可靠读取，不能导出项目名称。')
    if (exportProjects.value.length) {
      const currentProjects = await props.verifyProjects!().catch((cause) => {
        projectReadFailed = true
        throw cause
      })
      if (exportProjects.value.some(expected => !currentProjects.some(project => project.id === expected.id && project.label === expected.label && project.sourceVersion === expected.sourceVersion)))
        throw new Error('项目目录已变化，请关闭预览并重新读取。')
    }
    await exportFile({ data: createInvoiceLedgerXlsxFromRows(exportRows.value, style), defaultName: exportName.value, mimeType: INVOICE_XLSX_MIME })
    exportOpen.value = false
  }
  catch (cause) {
    exportError.value = message(cause)
    if (sourceUnavailable() || projectReadFailed) {
      error.value = exportError.value
      exportOpen.value = false
      exportRows.value = []
      exportVersions.value = []
      exportProjects.value = []
    }
  }
  finally { exportSaving.value = false }
}
async function print(payload: InvoicePrintRequest) {
  if (busy.value || pendingPrint.value || recoveryPending.value)
    return
  let targets: CentralInvoicePrintCommand['targets']
  try {
    targets = payload.ids.map((id) => {
      const source = printSource.value.find(record => record.id === id)
      const rotation = payload.rotations[id]
      if (!source || rotation === undefined)
        throw new Error('打印票据身份或角度已变化。')
      return { invoiceId: id, baseVersion: source.version, rotation }
    })
  }
  catch (cause) {
    error.value = message(cause)
    return
  }
  pendingPrint.value = payload
  printTargets.value = targets
  await nextTick()
  try {
    window.print()
  }
  catch {
    pendingPrint.value = null
    printTargets.value = []
    error.value = '系统打印窗口打开失败，请重试。'
  }
}
async function confirmPrinted() {
  if (!pendingPrint.value || !printTargets.value.length || recoveryPending.value)
    return
  await run(async () => {
    await props.workspace.recordPrinted(printTargets.value)
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
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="workspace.readState.value !== 'ready'" role="status" class="flex flex-wrap items-center gap-2 p-3">
      <span>{{ workspace.loading.value ? '正在读取发票台账…' : '发票来源尚不可用。' }}</span>
      <button type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="load">
        重新读取
      </button>
    </div>
    <div v-if="recoveryPending" role="status" class="flex flex-wrap items-center gap-2 p-3">
      <span>上次打印记录尚未核对，不能重复提交。</span>
      <button type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="recoverPrint">
        核对打印记录
      </button>
    </div>
    <p v-if="error" role="alert" class="p-3 text-sm text-danger">
      {{ error }}
    </p>
    <CentralInvoiceLedgerView v-show="workspace.readState.value === 'ready' && !printMode" class="min-h-0 flex-1" :records="displayedRecords" :projects="projects" :busy="busy || recoveryPending" @open="emit('open', $event)" @discard="discard" @prepare-print="preparePrint" @export="prepareExport" />
    <InvoicePrintLayout v-if="printMode && workspace.readState.value === 'ready'" v-model:selected-id="printSelectedId" :invoices="printModels" :print-confirmation="pendingPrint" full-page @print="print" @confirm-print="confirmPrinted" @cancel-print="pendingPrint = null; printTargets = []" @back="leavePrint" />
    <InvoiceExportPreview v-if="exportOpen" v-model:open="exportOpen" :rows="exportRows" :total-amount="exportTotal" :file-name="exportName" :saving="exportSaving" :error="exportError" @confirm="confirmExport" />
  </div>
</template>
