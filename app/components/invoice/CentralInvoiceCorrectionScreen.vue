<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { InvoiceMigrationCatalog } from '~/lib/invoice/central-migration-catalog'
import type { InvoiceCorrectionContent, InvoiceCorrectionDraft, InvoiceCorrectionFileInput } from '~/lib/invoice/correction-contract'
import type { createInvoiceCorrectionHttp } from '~/lib/invoice/correction-http'
import type { createInvoiceCorrectionSession } from '~/lib/invoice/correction-session'
import { computed, onMounted, shallowRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useKitUI } from '~/composables/useKitUI'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { invoiceCorrectionChanges } from '~/lib/invoice/correction-contract'
import { problemFromHttpFailure } from '~/lib/read-model/problem'
import CentralInvoiceCorrectionForm from './CentralInvoiceCorrectionForm.vue'

const props = defineProps<{ invoiceId: string, identity: { workspaceId: string, actorId: string }, client: ReturnType<typeof createInvoiceCorrectionHttp>, session: ReturnType<typeof createInvoiceCorrectionSession>, getInvoice: () => Promise<CentralInvoiceRecord>, catalog: InvoiceMigrationCatalog, signatories: Array<{ id: string, label: string, version: string }>, missing: string[] }>()
const emit = defineEmits<{ authorityLost: [message: string] }>()
const { confirm } = useKitUI()
const invoice = shallowRef<CentralInvoiceRecord | null>(null)
const drafts = shallowRef<InvoiceCorrectionDraft[]>([])
const draft = shallowRef<InvoiceCorrectionDraft | null>(null)
const baseline = shallowRef<InvoiceCorrectionContent | null>(null)
const proposed = shallowRef<InvoiceCorrectionContent | null>(null)
const reason = shallowRef('')
const newFiles = shallowRef<InvoiceCorrectionFileInput[]>([])
const removedFiles = shallowRef<string[]>([])
const history = shallowRef<Awaited<ReturnType<typeof props.client.history>>>([])
const dirty = shallowRef(false)
const fieldDirty = shallowRef(false)
const busy = shallowRef(false)
const error = shallowRef('')
const notice = shallowRef('')
const pending = shallowRef<ReturnType<typeof props.session.pending>>(null)
const recoveryOnly = shallowRef(false)
const sourceLabels: Record<string, string> = { projects: '项目', suppliers: '分供方', signatories: '我方主体', construction: '施工合同', subcontract: '分包合同', material: '采购合同', auxiliary: '其他支出合同', company: '公司支出合同' }
const changeLabels: Record<string, string> = { 'ownerKind': '归属', 'projectId': '项目', 'supplierId': '分供方', 'buyer': '我方主体', 'contract': '合同', 'items': '货物明细', 'fields.invoiceNumber': '发票号码', 'fields.invoiceDate': '开票日期', 'fields.invoiceType': '发票类型', 'fields.buyer': '购买方', 'fields.buyerTaxNo': '购买方税号', 'fields.seller': '销售方', 'fields.sellerTaxNo': '销售方税号', 'fields.amount': '不含税金额', 'fields.taxAmount': '税额', 'fields.totalAmount': '价税合计', 'fields.taxRate': '税率', 'fields.remark': '备注' }
function historicalValue(value: unknown) {
  if (value === null || value === '')
    return '未填写'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
const shownDraft = computed(() => draft.value ? { ...draft.value, attachments: draft.value.attachments.filter(file => !removedFiles.value.includes(file.id)) } : null)
const currentChanges = computed(() => baseline.value && proposed.value ? invoiceCorrectionChanges(baseline.value, proposed.value) : [])
const currentSources = computed(() => {
  const value = proposed.value
  if (!value || props.missing.includes('signatories') || props.missing.includes('suppliers') || (value.ownerKind === 'project' && props.missing.includes('projects')) || (value.contract && props.missing.includes(value.contract.domain)) || !value.buyer || !value.supplierId || !value.supplierVersion)
    return false
  return props.signatories.some(item => item.id === value.buyer!.id && item.version === value.buyer!.version)
    && props.catalog.suppliers.some(item => item.id === value.supplierId && item.version === value.supplierVersion)
    && (value.ownerKind !== 'project' || props.catalog.projects.some(item => item.id === value.projectId))
    && (value.ownerKind !== 'company' || value.contract?.domain === 'company')
    && (!value.contract || props.catalog.contracts.some(item => item.domain === value.contract!.domain && item.id === value.contract!.id && item.version === value.contract!.version
      && (!item.projectId || item.projectId === value.projectId) && (!item.supplierId || item.supplierId === value.supplierId)))
})
const editable = computed(() => !draft.value || draft.value.state === 'draft')
function message(cause: unknown) {
  return problemFromHttpFailure(cause)?.message ?? (cause instanceof Error ? cause.message : '当前操作不可用，请保留输入并重试。')
}
function refreshPending() {
  pending.value = props.session.pending()
}
function assign(record: InvoiceCorrectionDraft) {
  draft.value = record
  baseline.value = structuredClone(record.baseline)
  proposed.value = structuredClone(record.proposed)
  reason.value = record.reason
  newFiles.value = []
  removedFiles.value = []
  dirty.value = false
  fieldDirty.value = false
}
/** 不丢页面输入；只有原身份和同一基准经重新读取核实后，入口才重新显示本屏。 */
async function revalidate(getInvoice: () => Promise<CentralInvoiceRecord>, client: ReturnType<typeof createInvoiceCorrectionHttp>) {
  if (busy.value)
    throw new Error('原操作仍在处理中，请稍后重新读取。')
  const previousInvoice = invoice.value
  const freshInvoice = await getInvoice()
  if (freshInvoice.id !== props.invoiceId)
    throw new Error('原票身份无法核实，当前输入仍保留。')
  if (previousInvoice && freshInvoice.version !== previousInvoice.version && !pending.value)
    throw new Error('原票已变化，当前输入仍保留；请先核对新版本。')
  const freshDrafts = await client.list(props.invoiceId)
  if (previousInvoice && freshInvoice.version !== previousInvoice.version && pending.value) {
    recoveryOnly.value = true
    error.value = ''
    return
  }
  let freshHistory = history.value
  if (draft.value) {
    const fresh = await client.get(draft.value.id)
    if (fresh.invoiceId !== props.invoiceId)
      throw new Error('更正单身份无法核实，当前输入仍保留。')
    if (JSON.stringify(fresh) !== JSON.stringify(draft.value) && pending.value) {
      recoveryOnly.value = true
      error.value = ''
      return
    }
    if (JSON.stringify(fresh) !== JSON.stringify(draft.value))
      throw new Error('更正单已变化，当前输入仍保留；请先核对新版本。')
    freshHistory = await client.history(draft.value.id)
  }
  else if (baseline.value) {
    const fresh = await client.start(props.invoiceId, freshInvoice.version)
    if (JSON.stringify(fresh.baseline) !== JSON.stringify(baseline.value))
      throw new Error('原票或主体依据已变化，当前输入仍保留；请先核对新版本。')
  }
  else if (!freshDrafts.length && !pending.value) {
    const fresh = await client.start(props.invoiceId, freshInvoice.version)
    baseline.value = structuredClone(fresh.baseline)
    proposed.value = structuredClone(fresh.baseline)
  }
  invoice.value = freshInvoice
  drafts.value = freshDrafts
  history.value = freshHistory
  recoveryOnly.value = false
  error.value = ''
}
defineExpose({ revalidate })
async function guarded(work: () => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
  }
  catch (cause) {
    const problem = problemFromHttpFailure(cause)
    if (problem && ['forbidden', 'unauthenticated'].includes(problem.code))
      emit('authorityLost', problem.message)
    error.value = message(cause)
  }
  finally {
    busy.value = false
    try {
      refreshPending()
    }
    catch (cause) { error.value = message(cause) }
  }
}
async function mayLeave() {
  if (!dirty.value && !fieldDirty.value)
    return true
  return confirm({ variant: 'simple', title: '放弃未保存的更正', message: '当前输入或附件尚未保存。确定放弃并离开吗？', confirmLabel: '放弃修改' })
}
useTabCloseGuard(mayLeave)
onBeforeRouteLeave(mayLeave)
onBeforeRouteUpdate((to, from) => to.params.invoiceId === from.params.invoiceId ? true : mayLeave())
async function select(record: InvoiceCorrectionDraft) {
  if (!await mayLeave())
    return
  await guarded(async () => {
    assign(await props.client.get(record.id))
    history.value = await props.client.history(record.id)
  })
}
async function begin() {
  if (!invoice.value || !await mayLeave())
    return
  await guarded(async () => {
    const start = await props.client.start(props.invoiceId, invoice.value!.version)
    invoice.value = start.invoice
    baseline.value = structuredClone(start.baseline)
    proposed.value = structuredClone(start.baseline)
    draft.value = null
    reason.value = ''
    history.value = []
    newFiles.value = []
    removedFiles.value = []
    dirty.value = false
    fieldDirty.value = false
  })
}
async function load() {
  await guarded(async () => {
    invoice.value = await props.getInvoice()
    drafts.value = await props.client.list(props.invoiceId)
    if (!drafts.value.length && !pending.value) {
      const start = await props.client.start(props.invoiceId, invoice.value.version)
      baseline.value = structuredClone(start.baseline)
      proposed.value = structuredClone(start.baseline)
    }
  })
}
function setProposed(value: InvoiceCorrectionContent) {
  proposed.value = value
  dirty.value = true
}
function setReason(value: string) {
  reason.value = value
  dirty.value = true
}
async function addFiles(files: File[]) {
  await guarded(async () => {
    if (files.some(file => file.size > 10 * 1024 * 1024) || (shownDraft.value?.attachments.length ?? 0) + newFiles.value.length + files.length > 50)
      throw new Error('每个附件最多 10 MB，合计最多 50 个。')
    const inputs = await Promise.all(files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      return { fileName: file.name, fileSize: file.size, mimeType: file.type || 'application/octet-stream', payloadBase64: btoa(binary) }
    }))
    newFiles.value = [...newFiles.value, ...inputs]
    dirty.value = true
  })
}
async function save() {
  if (!invoice.value || !baseline.value || !proposed.value || fieldDirty.value || pending.value)
    return
  await guarded(async () => {
    const command = { action: 'save-draft' as const, workspaceId: props.identity.workspaceId, actorId: props.identity.actorId, commandId: crypto.randomUUID(), requiredCapability: 'finance-invoice:write' as const, invoiceId: props.invoiceId, baseInvoiceVersion: draft.value?.baseInvoiceVersion ?? invoice.value!.version, correctionId: draft.value?.id ?? null, baseCorrectionVersion: draft.value?.version ?? null, reason: reason.value, proposed: proposed.value!, keepFileIds: shownDraft.value?.attachments.map(file => file.id) ?? [], addFiles: newFiles.value }
    const result = await props.session.execute(command)
    assign(result.correction)
    drafts.value = await props.client.list(props.invoiceId)
    history.value = await props.client.history(result.correction.id)
    notice.value = '更正草稿已保存；原发票尚未改变。'
  })
}
async function submit() {
  if (!draft.value || dirty.value || fieldDirty.value || pending.value || !currentSources.value || !reason.value.trim() || !currentChanges.value.length)
    return
  if (!await confirm({ variant: 'simple', title: '确认提交更正', message: '请核对上面的原值与新值。提交后更正将生效，并保留原票及完整历史。', confirmLabel: '确认提交' }))
    return
  await guarded(async () => {
    const current = draft.value!
    const result = await props.session.execute({ action: 'submit', workspaceId: props.identity.workspaceId, actorId: props.identity.actorId, commandId: crypto.randomUUID(), requiredCapability: 'finance-invoice:write', invoiceId: props.invoiceId, baseInvoiceVersion: current.baseInvoiceVersion, correctionId: current.id, baseCorrectionVersion: current.version, confirmed: true })
    assign(result.correction)
    invoice.value = await props.getInvoice()
    drafts.value = await props.client.list(props.invoiceId)
    history.value = await props.client.history(current.id)
    notice.value = '更正已提交并重新读取。'
  })
}
async function recover() {
  await guarded(async () => {
    const result = await props.session.recover()
    if (result?.outcome === 'applied') {
      assign(result.correction)
      invoice.value = await props.getInvoice()
      drafts.value = await props.client.list(props.invoiceId)
      history.value = await props.client.history(result.correction.id)
      recoveryOnly.value = result.correction.state === 'draft' && invoice.value.version !== result.correction.baseInvoiceVersion
      notice.value = recoveryOnly.value ? '原提交已核对；原票版本已变化，当前输入仍保留，请先人工核对。' : '已核对原提交并重新读取。'
    }
    else if (result?.outcome === 'not-applied') {
      notice.value = recoveryOnly.value ? '原提交未生效；原票或更正单已变化，当前输入仍保留，请先人工核对。' : '原提交未生效，可以核对输入后重新提交。'
    }
  })
}
onMounted(() => {
  refreshPending()
  void load()
})
</script>

<template>
  <main class="h-full overflow-auto p-4">
    <header v-show="!recoveryOnly" class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-700">
          发票更正单
        </h1><p class="text-sm text-ink-soft">
          原票：{{ invoice?.fields.invoiceNumber || invoiceId }}
        </p>
      </div>
      <button type="button" :disabled="busy || !!pending" class="border border-line rounded px-3 py-2" @click="begin">
        新建更正单
      </button>
    </header>
    <p v-if="!recoveryOnly && invoice?.original" class="mb-3 text-sm">
      原票原件：
      <a :href="`/api/read/invoices/${encodeURIComponent(invoice.id)}/originals/${encodeURIComponent(invoice.original.id)}`" class="text-brand underline">{{ invoice.original.fileName }}</a>
    </p>
    <p v-else-if="!recoveryOnly && invoice" class="mb-3 text-sm text-ink-soft">
      原票没有可读取的原件，请结合现有资料核对。
    </p>
    <p v-if="error" role="alert" class="mb-3 text-danger">
      {{ error }}
    </p>
    <p v-if="notice" role="status" class="mb-3">
      {{ notice }}
    </p>
    <p v-if="missing.length" role="alert" class="mb-3 text-danger">
      资料来源不可用：{{ missing.map(item => sourceLabels[item] ?? item).join('、') }}。涉及这些资料时请恢复来源后再提交。
    </p>
    <div v-if="pending" class="mb-3 border border-warn rounded p-3" role="status">
      原提交结果尚待核对。<button type="button" :disabled="busy" class="ml-2 underline" @click="recover">
        核对原提交
      </button>
    </div>
    <p v-if="recoveryOnly" role="alert" class="mb-3 text-warn-ink">
      原票或更正单已变化，当前输入仍保留；{{ pending ? '请先核对原提交并重新读取。' : '请先人工核对原票及更正资料。' }}
    </p>
    <section v-if="!recoveryOnly && drafts.length" class="mb-4" aria-label="更正单记录">
      <h2 class="font-600">
        更正单记录
      </h2>
      <div class="mt-2 flex flex-wrap gap-2">
        <button v-for="item in drafts" :key="item.id" type="button" :disabled="busy || !!pending" class="border border-line rounded px-2 py-1 text-sm" @click="select(item)">
          {{ item.state === 'submitted' ? '已提交' : '草稿' }} · {{ item.updatedAt }}
        </button>
      </div>
    </section>
    <CentralInvoiceCorrectionForm v-if="invoice && baseline && proposed" v-show="!recoveryOnly" :key="draft?.id ?? 'new'" :invoice="invoice" :baseline="baseline" :proposed="proposed" :reason="reason" :catalog="catalog" :signatories="signatories" :draft="shownDraft" :busy="busy || !!pending" :editable="editable" @proposed="setProposed" @reason="setReason" @dirty="fieldDirty = $event" @add-files="addFiles" @remove-file="removedFiles = [...removedFiles, $event]; dirty = true" />
    <ul v-if="!recoveryOnly && newFiles.length" class="my-3 text-sm">
      <li v-for="(file, index) in newFiles" :key="index">
        待保存：{{ file.fileName }} <button type="button" class="text-danger" @click="newFiles = newFiles.filter((_, i) => i !== index); dirty = true">
          移除
        </button>
      </li>
    </ul>
    <p v-if="!recoveryOnly && fieldDirty" role="status" class="my-3 text-sm">
      请先应用票面修改，再保存更正草稿。
    </p>
    <p v-if="!recoveryOnly && baseline && editable && !currentSources" role="status" class="my-3 text-sm text-warn-ink">
      请重新选择当前有效的我方主体、分供方和适用合同；公司开销必须选择公司支出合同。
    </p>
    <div v-if="!recoveryOnly && baseline && editable" class="my-4 flex flex-wrap gap-2">
      <button type="button" :disabled="busy || !!pending || fieldDirty || !dirty" class="border border-line rounded px-4 py-2" @click="save">
        保存草稿
      </button>
      <button type="button" :disabled="busy || !!pending || !draft || dirty || fieldDirty || !currentSources || !reason.trim() || !currentChanges.length" class="rounded bg-brand px-4 py-2 text-white disabled:opacity-50" @click="submit">
        确认提交更正
      </button>
    </div>
    <section v-if="!recoveryOnly && history.length" class="mt-4" aria-label="更正历史">
      <h2 class="font-600">
        更正历史
      </h2>
      <ol class="mt-2 space-y-1 text-sm">
        <li v-for="entry in history" :key="entry.record.version">
          <details class="border border-line rounded p-2">
            <summary>{{ entry.createdAt }} · {{ entry.actorId }} · {{ entry.record.state === 'submitted' ? '提交生效' : '保存草稿' }} · 版本 {{ entry.record.version }}</summary>
            <p>原因：{{ entry.record.reason || '未填写' }}</p>
            <ul>
              <li v-for="change in invoiceCorrectionChanges(entry.record.baseline, entry.record.proposed)" :key="change.path" class="break-words">
                {{ changeLabels[change.path] ?? change.path }}：{{ historicalValue(change.before) }} → {{ historicalValue(change.after) }}
              </li>
            </ul>
            <ul>
              <li v-for="file in entry.record.attachments" :key="file.id">
                <a :href="`/api/read/invoice-corrections/${encodeURIComponent(entry.record.id)}/files/${encodeURIComponent(file.id)}`" class="text-brand underline">{{ file.fileName }}</a>
              </li>
            </ul>
          </details>
        </li>
      </ol>
    </section>
  </main>
</template>
