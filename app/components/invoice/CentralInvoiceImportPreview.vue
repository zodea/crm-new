<script setup lang="ts">
import type { CentralInvoiceFields, CentralInvoiceImportSource } from '~/lib/invoice/central-contract'
import type { InvoiceImportPreview } from '~/lib/invoice/central-http'
import type { InvoiceImportCatalogSnapshot, InvoiceImportPreviewRow } from '~/lib/invoice/central-import-preview'
import type { VerifiedCentralInvoiceWorkbook } from '~/lib/invoice/central-workbook-security'
import type { ImportMapping } from '~/lib/kit/import-mapping'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId } from 'vue'
import { hasAmbiguousInvoiceColumns, previewCentralInvoiceWorkbook } from '~/lib/invoice/central-import-preview'
import { centralInvoiceHeaderStatus } from '~/lib/invoice/central-workbook-headers'
import { openVerifiedCentralInvoiceWorkbook } from '~/lib/invoice/central-workbook-security'
import { IMPORT_SOURCE_META_KEY } from '~/lib/kit/import-mapping'
import { problemFromHttpFailure } from '~/lib/read-model/problem'

const props = defineProps<{
  loadCatalog: () => Promise<InvoiceImportCatalogSnapshot>
  preview: (input: { fields: CentralInvoiceFields, items: [], source: CentralInvoiceImportSource }) => Promise<InvoiceImportPreview>
}>()
const emit = defineEmits<{ authorityLost: [message: string] }>()
const fields: Array<{ key: keyof CentralInvoiceFields, label: string }> = [
  { key: 'invoiceNumber', label: '发票号码' },
  { key: 'invoiceDate', label: '发票日期' },
  { key: 'invoiceType', label: '发票类型' },
  { key: 'buyer', label: '购买方' },
  { key: 'buyerTaxNo', label: '购买方税号' },
  { key: 'seller', label: '销售方' },
  { key: 'sellerTaxNo', label: '销售方税号' },
  { key: 'amount', label: '金额' },
  { key: 'taxAmount', label: '税额' },
  { key: 'totalAmount', label: '价税合计' },
  { key: 'taxRate', label: '税率' },
  { key: 'remark', label: '备注' },
]
const file = shallowRef<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const verifiedWorkbook = shallowRef<VerifiedCentralInvoiceWorkbook | null>(null)
const workbook = computed(() => verifiedWorkbook.value?.workbook ?? null)
const selectedSheet = ref('')
const columns = ref<Record<string, string>>({})
const result = shallowRef<{ rows: InvoiceImportPreviewRow[], catalog: InvoiceImportCatalogSnapshot['catalog'] } | null>(null)
const selections = ref<Record<number, { owner: string, supplier: string }>>({})
const busy = ref(false)
const error = ref('')
let generation = 0
let requestController: AbortController | null = null
const sheet = computed(() => workbook.value?.sheets.find(item => item.name === selectedSheet.value))
const headerStatus = computed(() => sheet.value && verifiedWorkbook.value ? centralInvoiceHeaderStatus(verifiedWorkbook.value.headers, sheet.value) : 'missing')
const ambiguousSheet = computed(() => !!sheet.value && (hasAmbiguousInvoiceColumns(sheet.value.columns) || headerStatus.value !== 'valid'))
const ambiguousMessageId = useId()

function invalidate() {
  generation++
  requestController?.abort()
  requestController = null
  result.value = null
  selections.value = {}
  error.value = ''
  busy.value = false
}
defineExpose({ invalidateAuthority: invalidate })
onBeforeUnmount(invalidate)
async function pickFile(event: Event) {
  const target = event.currentTarget as HTMLInputElement
  const selected = target.files?.[0]
  const restoreFocus = typeof document !== 'undefined' && document.activeElement === target
  target.value = ''
  invalidate()
  file.value = null
  verifiedWorkbook.value = null
  selectedSheet.value = ''
  columns.value = {}
  if (!selected)
    return
  if (!/\.(?:xlsx|xls)$/i.test(selected.name)) {
    error.value = '请选择 Excel 文件（.xlsx 或 .xls）。'
    return
  }
  file.value = selected
  const current = generation
  await parseSelectedFile(selected)
  await nextTick()
  if (restoreFocus && current === generation && fileInput.value === target && document.activeElement === document.body)
    target.focus({ preventScroll: true })
}
async function parseSelectedFile(selected: File) {
  const current = generation
  const controller = new AbortController()
  requestController = controller
  busy.value = true
  try {
    const verified = await openVerifiedCentralInvoiceWorkbook(selected, controller.signal)
    if (current !== generation)
      return
    if (verified.file !== selected)
      throw new Error('所选文件身份无法核验，请重新选择。')
    verifiedWorkbook.value = verified
    selectedSheet.value = verified.workbook.sheets.find(item => item.sheetKind === 'data' && item.rows.length)?.name ?? ''
    if (!selectedSheet.value)
      error.value = '文件没有可预览的发票数据工作表。'
  }
  catch (cause) {
    if (current === generation)
      error.value = cause instanceof Error ? cause.message : '无法读取文件。'
  }
  finally {
    if (current === generation) {
      busy.value = false
      requestController = null
    }
  }
}
async function retryFile() {
  if (!file.value || busy.value)
    return
  invalidate()
  await parseSelectedFile(file.value)
}
function changeSheet(event: Event) {
  invalidate()
  selectedSheet.value = (event.currentTarget as HTMLSelectElement).value
  columns.value = {}
}
function changeColumn(key: string, event: Event) {
  invalidate()
  columns.value = { ...columns.value, [key]: (event.currentTarget as HTMLSelectElement).value }
}
async function runPreview() {
  if (!file.value || !sheet.value || ambiguousSheet.value || busy.value)
    return
  invalidate()
  const current = generation
  const controller = new AbortController()
  requestController = controller
  busy.value = true
  const mapping: ImportMapping = Object.fromEntries(Object.entries(columns.value).filter(([, column]) => column).map(([key, column]) => [key, { column, confidence: 'confirmed' }]))
  try {
    const preview = await previewCentralInvoiceWorkbook({ file: file.value, sheetName: sheet.value.name, mapping, loadCatalog: props.loadCatalog, preview: props.preview, signal: controller.signal })
    if (current !== generation)
      return
    result.value = preview
    selections.value = Object.fromEntries(preview.rows.map(row => [row.source.rowNumber, { owner: '', supplier: '' }]))
  }
  catch (cause) {
    if (current === generation) {
      const problem = problemFromHttpFailure(cause)
      if (problem && ['forbidden', 'unauthenticated'].includes(problem.code))
        emit('authorityLost', problem.message)
      else
        error.value = cause instanceof Error ? cause.message : '预览失败，请重新读取。'
    }
  }
  finally {
    if (current === generation) {
      busy.value = false
      requestController = null
    }
  }
}
function display(value: string | number | null) {
  return value === null || value === '' ? '未填写' : String(value)
}
</script>

<template>
  <section aria-label="发票 Excel 只读预览" class="grid gap-4">
    <p>中央发票工作簿安全核验尚未完成，暂不能预览或导入；请选择文件并保留原件，待安全核验可用后重试。</p>
    <label>选择 Excel 文件 <input ref="fileInput" type="file" accept=".xlsx,.xls" :disabled="busy" @change="pickFile"></label>
    <p v-if="file && workbook" role="status">
      已选择文件 {{ file.name }}。
    </p>
    <p v-if="file && !workbook && !busy" role="status">
      已保留所选文件 {{ file.name }}。
      <button type="button" class="underline" @click="retryFile">
        重新解析文件
      </button>
    </p>
    <label v-if="workbook">工作表
      <select :value="selectedSheet" :disabled="busy" :aria-describedby="ambiguousSheet ? ambiguousMessageId : undefined" @change="changeSheet">
        <option value="">请选择工作表</option>
        <option v-for="item in workbook.sheets" :key="item.name" :value="item.name" :disabled="item.sheetKind !== 'data' || !item.rows.length">
          {{ item.name }}（{{ item.rows.length }} 行）
        </option>
      </select>
    </label>
    <p v-if="ambiguousSheet" :id="ambiguousMessageId" role="alert">
      {{ sheet && !hasAmbiguousInvoiceColumns(sheet.columns) && headerStatus === 'missing' ? '工作表原始表头证据不可核验，请重新选择文件。' : '该工作表存在无法区分的列名，请调整表头后重新选择文件，或选择其他工作表。' }}
    </p>
    <fieldset v-if="sheet && !ambiguousSheet" :disabled="busy" class="grid gap-2">
      <legend>确认字段映射</legend>
      <label v-for="field in fields" :key="field.key">
        {{ field.label }}
        <select :aria-label="`${field.label}的源列`" :value="columns[field.key] ?? ''" @change="changeColumn(field.key, $event)">
          <option value="">不映射</option>
          <option v-for="column in sheet.columns" :key="column" :value="column" :disabled="column === IMPORT_SOURCE_META_KEY">{{ column }}{{ column === IMPORT_SOURCE_META_KEY ? '（不可映射）' : '' }}</option>
        </select>
      </label>
    </fieldset>
    <button type="button" class="btn-primary w-fit" :disabled="!sheet || ambiguousSheet" :aria-disabled="busy" @click="runPreview">
      读取只读预览
    </button>
    <p v-if="busy" role="status">
      正在读取…
    </p>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <div v-if="result" aria-label="预览结果" class="grid gap-4">
      <p role="status">
        查重结果基于本次查询时点；来源可能继续变化，使用前请重新核对。
      </p>
      <article v-for="row in result.rows" :key="row.source.rowNumber" class="border border-line rounded p-3">
        <h3>{{ row.source.sheetName }} · 第 {{ row.source.rowNumber }} 行</h3>
        <dl>
          <template v-for="field in fields" :key="field.key">
            <template v-if="row.mappedFields.includes(field.key)">
              <dt>{{ field.label }}</dt><dd>{{ display(row.fields[field.key]) }}</dd>
            </template>
          </template>
        </dl>
        <p v-if="row.reviewReasons.length">
          需核对：{{ row.reviewReasons.join('；') }}
        </p>
        <p v-if="!row.duplicatePreview">
          未查询重复项，请先修正来源数据。
        </p>
        <p v-else-if="!row.duplicatePreview.candidates.length">
          本次查询未发现重复候选。
        </p>
        <div v-else>
          <p>已有候选，需人工核对：</p>
          <ul>
            <li v-for="candidate in row.duplicatePreview.candidates" :key="candidate.record.id">
              {{ candidate.record.fields.invoiceNumber }} · {{ candidate.record.id }} · 版本 {{ candidate.record.version }}
              <ul>
                <template v-for="field in fields" :key="field.key">
                  <li v-if="row.mappedFields.includes(field.key) && candidate.differences.includes(field.key)">
                    {{ field.label }}：已有 {{ display(candidate.record.fields[field.key]) }} → 表格 {{ display(row.fields[field.key]) }}
                  </li>
                </template>
              </ul>
            </li>
          </ul>
        </div>
        <label>人工选择归属
          <select v-model="selections[row.source.rowNumber]!.owner" :aria-label="`第 ${row.source.rowNumber} 行归属`">
            <option value="">尚未选择</option>
            <option value="personal">个人开支</option>
            <option v-for="project in result.catalog.projects" :key="project.id" :value="`project:${project.id}`">{{ project.label }}（{{ project.id }}）</option>
          </select>
        </label>
        <label>人工选择分供方
          <select v-model="selections[row.source.rowNumber]!.supplier" :aria-label="`第 ${row.source.rowNumber} 行分供方`">
            <option value="">尚未选择</option>
            <option v-for="supplier in result.catalog.suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.label }}（{{ supplier.id }}）</option>
          </select>
        </label>
      </article>
    </div>
  </section>
</template>
