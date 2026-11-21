<script setup lang="ts">
import type { CentralInvoiceFields, CentralInvoiceItem, CentralInvoiceRecord, InvoiceContractReference, InvoiceTaxVerificationSelection } from '~/lib/invoice/central-contract'
import type { CentralInvoiceFormSnapshot } from '~/lib/invoice/central-form-snapshot'
import type { LocalInvoiceCandidate } from '~/lib/invoice/recognize'
import { useDropZone } from '@vueuse/core'
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useInvoiceRegionTarget } from '~/composables/useInvoiceRegionTarget'
import { INVOICE_RECOGNITION_FIELDS, invoiceRecognitionChanges, invoiceRecognitionMarks } from '~/lib/invoice/recognition-changes'
import { invoiceRegionFocus, invoiceRegionHighlights } from '~/lib/invoice/recognition-regions'
import AdaptiveWorkbench from '../shared/AdaptiveWorkbench.vue'
import CentralInvoiceFieldsForm from './CentralInvoiceFieldsForm.vue'
import CentralInvoiceQueue from './CentralInvoiceQueue.vue'
import InvoiceRegionViewer from './InvoiceRegionViewer.vue'

interface ReferenceOption { id: string, label: string }
interface VersionedReferenceOption extends ReferenceOption { version: string }
interface ContractOption extends InvoiceContractReference { label: string, projectId?: string | null, supplierId?: string | null }
const props = defineProps<{
  records: readonly CentralInvoiceRecord[]
  selectedId: string | null
  originalFile: File | null
  originalLoading: boolean
  busy: boolean
  cloudAvailable: boolean
  projects: readonly ReferenceOption[]
  suppliers: readonly VersionedReferenceOption[]
  signatories: readonly VersionedReferenceOption[]
  contracts?: readonly ContractOption[]
  draftRecord?: CentralInvoiceRecord | null
  recognitionBaseline?: CentralInvoiceFormSnapshot | null
  restoredSnapshot?: CentralInvoiceFormSnapshot | null
  regionCandidate?: LocalInvoiceCandidate | null
  selectionUnavailable?: boolean
  error?: string
}>()
const emit = defineEmits<{
  select: [id: string]
  upload: [files: File[], projectId: string | null]
  manual: []
  attach: [file: File]
  save: [payload: { invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[] }]
  review: [manualCompletion: boolean]
  archive: [payload: { ownerKind: 'project' | 'personal' | 'company', projectId: string | null, supplierId: string, taxVerification: InvoiceTaxVerificationSelection, contract?: InvoiceContractReference | null }]
  discard: []
  recognize: [source: 'local' | 'cloud']
  retryOriginal: []
  saveRecognition: []
  discardRecognition: []
  linkContract: [contract: InvoiceContractReference | null]
  confirmLegacy: []
  dirty: [value: boolean]
}>()
const selected = computed(() => props.records.find(record => record.id === props.selectedId) ?? null)
const fieldRecord = computed(() => props.draftRecord && props.draftRecord.id === selected.value?.id ? props.draftRecord : selected.value)
const ownerKind = ref<'project' | 'personal' | 'company' | ''>('')
const projectId = ref('')
const supplierId = ref('')
const buyerId = ref('')
const supplierVersion = ref('')
const buyerVersion = ref('')
const formDirty = ref(false)
const fieldsForm = useTemplateRef<InstanceType<typeof CentralInvoiceFieldsForm>>('fieldsForm')
const queue = useTemplateRef<InstanceType<typeof CentralInvoiceQueue>>('queue')
const dropZone = useTemplateRef<HTMLElement>('dropZone')
const dropError = shallowRef('')
const { files: droppedFiles, isOverDropZone } = useDropZone(dropZone, {
  checkValidity: items => Array.from(items).some(item => item.kind === 'file'),
  preventDefaultForUnhandled: true,
  onDrop: (files) => {
    droppedFiles.value = null
    dropError.value = queue.value?.acceptFiles(files) ?? '上传入口暂不可用，请重新读取。'
  },
})
function forwardUpload(files: File[], projectId: string | null) {
  dropError.value = ''
  emit('upload', files, projectId)
}
defineExpose({ captureForm: () => fieldsForm.value?.capture() ?? null })
const activePane = shallowRef<'queue' | 'source' | 'review'>('queue')
const sourceFromReview = shallowRef(false)
watch(activePane, (pane, previous) => {
  sourceFromReview.value = pane === 'source' && previous === 'review'
}, { flush: 'sync' })
const regionTarget = useInvoiceRegionTarget({ revealLast: () => sourceFromReview.value && !!props.originalFile })
const verifiedPages = shallowRef<number[]>([])
const currentSnapshot = shallowRef<CentralInvoiceFormSnapshot | null>(null)
const fieldsForRegions = [...INVOICE_RECOGNITION_FIELDS, { key: 'amount', label: '不含税金额' }]
function snapshotFields(snapshot: CentralInvoiceFormSnapshot) {
  const numeric = (value: string) => !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : value
  return { ...snapshot.fields, amount: numeric(snapshot.money.amount), taxAmount: numeric(snapshot.money.taxAmount), totalAmount: numeric(snapshot.money.totalAmount) }
}
const regionMarks = computed(() => props.draftRecord && props.recognitionBaseline
  ? invoiceRecognitionMarks(fieldsForRegions, snapshotFields(props.recognitionBaseline), props.draftRecord.fields, currentSnapshot.value ? snapshotFields(currentSnapshot.value) : props.draftRecord.fields)
  : {})
const regionChanges = computed(() => props.draftRecord && props.recognitionBaseline
  ? invoiceRecognitionChanges(fieldsForRegions, snapshotFields(props.recognitionBaseline), currentSnapshot.value ? snapshotFields(currentSnapshot.value) : props.draftRecord.fields)
  : [])
const regionDisplay = computed(() => props.draftRecord
  ? { mode: 'compare' as const, ...invoiceRegionHighlights(fieldsForRegions, regionMarks.value, props.regionCandidate?.fieldRegions) }
  : { mode: 'focus' as const, ...invoiceRegionFocus(fieldsForRegions, props.regionCandidate?.fieldRegions, regionTarget.active.value) })
const locatedKeys = computed(() => Object.entries(props.regionCandidate?.fieldRegions ?? {}).filter(([, region]) => verifiedPages.value.includes(region.pageIndex)).map(([key]) => key))
watch([() => props.selectedId, () => props.regionCandidate], () => {
  verifiedPages.value = []
  currentSnapshot.value = null
  regionTarget.reset()
})
const contractKey = ref('')
const contractOptionKey = (contract: InvoiceContractReference) => JSON.stringify([contract.domain, contract.id, contract.version])
const legacyOriginalLabels = { 'recorded': '旧资料中有原件记录', 'legacy-path-unverified': '旧路径未核实', 'session-original-unavailable': '旧会话原件已不可用', 'no-original-recorded': '旧资料未记录原件' } as const
const selectedContract = computed(() => props.contracts?.find(contract => contractOptionKey(contract) === contractKey.value) ?? null)
watch(() => selected.value?.id, () => {
  ownerKind.value = selected.value?.ownerKind ?? ''
  projectId.value = selected.value?.projectId ?? ''
  supplierId.value = selected.value?.supplierId ?? ''
  supplierVersion.value = props.suppliers.find(item => item.id === supplierId.value)?.version ?? ''
  buyerId.value = ''
  buyerVersion.value = ''
  contractKey.value = selected.value?.contract ? contractOptionKey(selected.value.contract) : ''
  formDirty.value = false
}, { immediate: true })
watch(() => props.suppliers, () => {
  if (supplierId.value && !props.suppliers.some(item => item.id === supplierId.value && item.version === supplierVersion.value)) {
    supplierId.value = ''
    supplierVersion.value = ''
    contractKey.value = ''
  }
}, { deep: true, flush: 'sync' })
watch(() => props.signatories, () => {
  if (buyerId.value && !props.signatories.some(item => item.id === buyerId.value && item.version === buyerVersion.value)) {
    buyerId.value = ''
    buyerVersion.value = ''
  }
}, { deep: true, flush: 'sync' })
function selectSupplier() {
  supplierVersion.value = props.suppliers.find(item => item.id === supplierId.value)?.version ?? ''
  contractKey.value = ''
}
function selectBuyer() {
  buyerVersion.value = props.signatories.find(item => item.id === buyerId.value)?.version ?? ''
}
function reconcileContract() {
  const contract = selectedContract.value
  if (!contract || ownerKind.value === '' || ownerKind.value === 'personal'
    || (ownerKind.value === 'company' && (contract.domain !== 'company' || contract.supplierId !== supplierId.value))
    || (ownerKind.value === 'project' && (contract.domain === 'company' || (!!contract.projectId && contract.projectId !== projectId.value) || (!!contract.supplierId && contract.supplierId !== supplierId.value)))) {
    contractKey.value = ''
  }
}
function attach(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file)
    emit('attach', file)
}
function archive() {
  if (formDirty.value || props.selectionUnavailable)
    return
  if (ownerKind.value !== 'project' && ownerKind.value !== 'personal' && ownerKind.value !== 'company')
    return
  if (selected.value?.sourceKind === 'manual' && selected.value.ownerKind === null && ownerKind.value === 'personal')
    return
  if (selected.value?.sourceKind === 'scan' && selected.value.ownerKind === 'project' && ownerKind.value !== 'project')
    return
  if (ownerKind.value === 'project' && !props.projects.some(project => project.id === projectId.value))
    return
  const supplier = props.suppliers.find(item => item.id === supplierId.value)
  const buyer = props.signatories.find(item => item.id === buyerId.value)
  if (!supplier || !buyer || supplier.version !== supplierVersion.value || buyer.version !== buyerVersion.value)
    return
  const contract = selectedContract.value
  if (ownerKind.value === 'company' && (!contract || contract.domain !== 'company' || contract.supplierId !== supplier.id))
    return
  if (ownerKind.value === 'project' && contractKey.value && (!contract || contract.domain === 'company' || (contract.projectId && contract.projectId !== projectId.value) || (contract.supplierId && contract.supplierId !== supplier.id)))
    return
  emit('archive', { ownerKind: ownerKind.value, projectId: ownerKind.value === 'project' ? projectId.value : null, supplierId: supplier.id, taxVerification: { buyerId: buyer.id, buyerVersion: buyer.version, supplierVersion: supplier.version }, ...(contract && ownerKind.value !== 'personal' ? { contract: { domain: contract.domain, id: contract.id, version: contract.version } } : {}) })
}
function setDirty(value: boolean) {
  formDirty.value = value
  currentSnapshot.value = fieldsForm.value?.capture() ?? null
  emit('dirty', value)
}
</script>

<template>
  <div ref="dropZone" role="region" aria-label="发票识别与核对" class="relative flex h-full min-h-0 flex-col gap-3 p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-lg font-700">
        发票识别与核对
      </h1>
      <span class="text-sm text-ink-soft">已上传原件保存在当前工作区</span>
    </div>
    <p v-if="error" role="alert" class="rounded border border-danger p-3 text-sm text-danger">
      {{ error }}
    </p>
    <p v-if="dropError" role="alert" class="rounded border border-danger p-3 text-sm text-danger">
      {{ dropError }}
    </p>
    <div v-if="isOverDropZone && !busy" class="pointer-events-none absolute inset-1 z-40 grid place-items-center border-2 border-dashed border-brand rounded bg-panel/90" aria-hidden="true">
      拖入发票文件上传
    </div>
    <AdaptiveWorkbench v-model="activePane" class="min-h-0 flex-1" :labels="{ queue: '队列', source: '原件', review: '校对' }" wide-columns="minmax(180px,1fr) minmax(280px,2fr) minmax(320px,2fr)">
      <template #queue>
        <CentralInvoiceQueue ref="queue" :records="records" :selected-id="selectedId" :projects="projects" :busy="busy" @select="emit('select', $event)" @upload="forwardUpload" @manual="emit('manual')" />
      </template>
      <template #source>
        <section class="flex min-h-65 min-w-0 flex-col overflow-hidden rounded border border-line bg-panel p-3" aria-label="发票原件">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-600">
              发票原件
            </h2>
            <div v-if="selected" class="flex flex-wrap gap-2">
              <button type="button" :disabled="busy || selectionUnavailable || (formDirty && selected.ocrStatus !== 'done') || !!draftRecord || !selected.original || selected.accountStatus === 'archived'" class="rounded border border-line px-2 py-1 text-sm" @click="emit('recognize', 'local')">
                {{ selected.ocrStatus === 'done' ? '本机重新识别' : '本机识别' }}
              </button>
              <button type="button" :disabled="busy || selectionUnavailable || (formDirty && selected.ocrStatus !== 'done') || !!draftRecord || !selected.original || !cloudAvailable || selected.accountStatus === 'archived'" class="rounded border border-line px-2 py-1 text-sm" @click="emit('recognize', 'cloud')">
                云识别
              </button>
            </div>
          </div>
          <p v-if="selected && !cloudAvailable" class="mb-2 text-xs text-ink-soft">
            云识别未启用；默认使用本机识别。
          </p>
          <p v-if="selectionUnavailable" role="status" class="p-4 text-sm">
            此发票已不在当前来源中；原件不能继续读取。
          </p>
          <p v-else-if="originalLoading" role="status" class="p-4 text-sm">
            正在读取原件…
          </p>
          <InvoiceRegionViewer v-else-if="selected && originalFile" :file="originalFile" :mode="regionDisplay.mode" :groups="regionDisplay.groups" :unlocated="regionDisplay.unlocated" :active-key="regionTarget.active.value" :frames="regionCandidate?.regionFrames ?? []" class="min-h-0 flex-1" @verified-pages="verifiedPages = $event" />
          <div v-else-if="selected" class="p-4 text-sm text-ink-soft">
            <p>{{ selected.original ? '原件暂时无法读取，请重试。' : '这张发票尚未保存原件。' }}</p>
            <button v-if="selected.original" type="button" :disabled="busy" class="mt-2 rounded border border-line px-3 py-1" @click="emit('retryOriginal')">
              重试读取原件
            </button>
            <label v-if="!selected.original && (selected.sourceKind === 'manual' || selected.sourceKind === 'excel' || selected.sourceKind === 'legacy')" class="mt-2 inline-flex cursor-pointer rounded border border-line px-3 py-1 focus-within:ring-2 focus-within:ring-brand">
              关联原件
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" class="sr-only" :disabled="busy" @change="attach">
            </label>
          </div>
          <p v-else class="p-4 text-sm text-ink-soft">
            从队列选择发票查看原件。
          </p>
        </section>
      </template>
      <template #review>
        <div class="flex min-h-0 min-w-0 flex-col gap-3 overflow-auto">
          <slot name="original-verification" />
          <p v-if="selected?.legacy" role="status" class="rounded border border-line bg-panel p-3 text-sm">
            旧资料：{{ legacyOriginalLabels[selected.legacy.originalState] }}。<span v-if="selected.legacy.ambiguousZeroFields.length || selected.legacy.ambiguousItemNumbers">旧金额或明细中的零可能表示未知，请结合原件核对。</span>
          </p>
          <button v-if="selected?.legacy && selected.accountStatus === 'archived' && selected.completionMethod === 'legacy'" type="button" :disabled="busy || selectionUnavailable || formDirty || !!draftRecord || (selected.legacy.source === 'scan' && !selected.original)" class="rounded border border-line bg-panel px-3 py-2 text-sm" @click="emit('confirmLegacy')">
            核对旧发票后用于新付款
          </button>
          <div v-if="draftRecord" role="status" class="rounded border border-line bg-panel p-3 text-sm">
            <p>重新识别结果为未保存草稿；保存前会列出变化并要求确认。</p>
            <ul v-if="regionChanges.length" class="mt-2 space-y-1">
              <li v-for="change in regionChanges" :key="change.key">
                <button type="button" class="text-left underline" @focus="regionTarget.locate(change.key)" @mouseenter="regionTarget.preview(change.key)" @mouseleave="regionTarget.preview(null)">
                  {{ change.label }}：{{ change.before || '未填写' }} → {{ change.after || '未填写' }}{{ locatedKeys.includes(change.key) ? '' : '（原图未定位）' }}
                </button>
              </li>
            </ul>
            <div class="mt-2 flex flex-wrap gap-2">
              <button type="button" :disabled="busy || selectionUnavailable || formDirty" class="rounded border border-line px-2 py-1" @click="emit('saveRecognition')">
                保存识别草稿
              </button>
              <button type="button" :disabled="busy" class="rounded border border-line px-2 py-1" @click="emit('discardRecognition')">
                放弃识别草稿
              </button>
            </div>
          </div>
          <div v-if="selected?.accountStatus === 'archived'" role="status" class="rounded border border-line p-2 text-sm text-ink-soft">
            发票已归档；票面与关联须通过更正单修改。存在付款关联或打印历史时请先人工核对。
            <NuxtLink v-if="!busy && !selectionUnavailable" :to="`/finance/invoice/correction/${encodeURIComponent(selected.id)}`" class="ml-2 text-brand underline">
              查看或新建更正单
            </NuxtLink>
          </div>
          <CentralInvoiceFieldsForm v-if="fieldRecord" :key="`${fieldRecord.id}:${draftRecord ? 'draft' : 'saved'}`" ref="fieldsForm" :record="fieldRecord" :baseline="draftRecord ? selected : null" :baseline-snapshot="draftRecord ? recognitionBaseline : null" :restored-snapshot="draftRecord ? null : restoredSnapshot" :location-keys="originalFile ? locatedKeys : undefined" :busy="busy" :lock-actions="!!draftRecord || selectionUnavailable" :disable-save="selectionUnavailable || selected?.accountStatus === 'archived'" @save="emit('save', $event)" @review="emit('review', $event)" @discard="emit('discard')" @dirty="setDirty" @locate="regionTarget.locate" @preview="regionTarget.preview" @release="regionTarget.release" />
          <section v-if="selected && selected.accountStatus === 'none'" class="rounded border border-line bg-panel p-3" aria-label="发票归属">
            <h2 class="mb-2 font-600">
              归档归属
            </h2>
            <p v-if="!selected.fields.buyerTaxNo.trim() || !selected.fields.sellerTaxNo.trim()" role="status" class="mb-2 text-sm text-warn-ink">
              本业务归档需购销双方税号；请核对原件，缺失时联系开票方处理。原件和草稿可继续保存。
            </p>
            <label class="mb-2 flex flex-col gap-1 text-sm">
              归属类型
              <select v-model="ownerKind" :disabled="busy" class="border border-line rounded bg-surface p-1" @change="reconcileContract">
                <option value="">请选择</option>
                <option v-if="selected.ownerKind !== 'company'" value="project">项目</option>
                <option v-if="selected.ownerKind === 'company' || (selected.sourceKind === 'manual' && selected.ownerKind === null)" value="company">公司开销</option>
                <option v-if="selected.ownerKind !== 'company' && !(selected.sourceKind === 'manual' && selected.ownerKind === null) && (selected.sourceKind !== 'scan' || selected.ownerKind !== 'project')" value="personal">个人开支</option>
              </select>
            </label>
            <label v-if="ownerKind === 'project'" class="mb-2 flex flex-col gap-1 text-sm">
              项目
              <select v-model="projectId" :disabled="busy" class="border border-line rounded bg-surface p-1" @change="reconcileContract">
                <option value="">请选择项目</option>
                <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.label }}（{{ project.id }}）</option>
              </select>
            </label>
            <label class="mb-2 flex flex-col gap-1 text-sm">
              我方购买公司
              <select v-model="buyerId" :disabled="busy" class="border border-line rounded bg-surface p-1" @change="selectBuyer">
                <option value="">请选择已有我方主体</option>
                <option v-for="buyer in signatories" :key="buyer.id" :value="buyer.id">{{ buyer.label }}（{{ buyer.id }}）</option>
              </select>
            </label>
            <label class="mb-2 flex flex-col gap-1 text-sm">
              分供方公司
              <select v-model="supplierId" :disabled="busy" class="border border-line rounded bg-surface p-1" @change="selectSupplier">
                <option value="">请选择已有分供方</option>
                <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.label }}（{{ supplier.id }}）</option>
              </select>
            </label>
            <label v-if="ownerKind === 'company'" class="mb-2 flex flex-col gap-1 text-sm">
              公司支出合同
              <select v-model="contractKey" :disabled="busy" class="border border-line rounded bg-surface p-1">
                <option value="">请选择已有公司合同</option>
                <option v-for="contract in (contracts ?? []).filter(item => item.domain === 'company' && item.supplierId === supplierId)" :key="contractOptionKey(contract)" :value="contractOptionKey(contract)">{{ contract.label }}（{{ contract.id }}）</option>
              </select>
            </label>
            <label v-if="ownerKind === 'project'" class="mb-2 flex flex-col gap-1 text-sm">
              项目合同（可选）
              <select v-model="contractKey" :disabled="busy" class="border border-line rounded bg-surface p-1">
                <option value="">暂不关联合同</option>
                <option v-for="contract in (contracts ?? []).filter(item => item.domain !== 'company' && (!item.projectId || item.projectId === projectId) && (!item.supplierId || item.supplierId === supplierId))" :key="contractOptionKey(contract)" :value="contractOptionKey(contract)">{{ contract.label }}（{{ contract.id }}）</option>
              </select>
            </label>
            <button type="button" :disabled="busy || selectionUnavailable || formDirty || !!draftRecord || selected.reviewStatus !== 'reviewed' || !selected.fields.buyerTaxNo.trim() || !selected.fields.sellerTaxNo.trim() || !signatories.some(item => item.id === buyerId && item.version === buyerVersion) || !suppliers.some(item => item.id === supplierId && item.version === supplierVersion) || !ownerKind || (ownerKind === 'project' && (!projects.some(item => item.id === projectId) || (!!contractKey && (!selectedContract || selectedContract.domain === 'company' || (!!selectedContract.projectId && selectedContract.projectId !== projectId) || (!!selectedContract.supplierId && selectedContract.supplierId !== supplierId))))) || (ownerKind === 'company' && (!selectedContract || selectedContract.domain !== 'company' || selectedContract.supplierId !== supplierId))" class="rounded border border-line px-3 py-1 text-sm" @click="archive">
              归档发票
            </button>
          </section>
          <section v-if="selected && selected.accountStatus === 'archived' && selected.ownerKind !== 'company'" class="rounded border border-line bg-panel p-3" aria-label="关联合同">
            <h2 class="mb-2 font-600">
              关联合同
            </h2>
            <p v-if="selected.contract" class="mb-2 break-all text-sm text-ink-soft">
              当前合同：{{ selected.contract.id }}（版本 {{ selected.contract.version }}）
            </p>
            <p class="text-sm text-ink-soft">
              合同关联的修改须使用独立更正单。
            </p>
          </section>
        </div>
      </template>
    </AdaptiveWorkbench>
  </div>
</template>
