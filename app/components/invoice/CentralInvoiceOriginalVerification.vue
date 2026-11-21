<script setup lang="ts">
import type { CentralInvoiceRecord, InvoiceOriginalVerificationRead } from '~/lib/invoice/central-contract'
import type { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import { computed, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { useKitUI } from '~/composables/useKitUI'

const props = defineProps<{
  invoice: CentralInvoiceRecord
  workspace: ReturnType<typeof createCentralInvoiceWorkspace>
  disabled: boolean
  originalVisible: boolean
  cloudAvailable?: boolean
}>()
const emit = defineEmits<{ busy: [value: boolean], settled: [] }>()
const { confirm } = useKitUI()
const review = shallowRef<InvoiceOriginalVerificationRead | null>(null)
const reading = shallowRef(false)
const working = shallowRef(false)
const readingError = shallowRef('')
const actionError = shallowRef('')
const canAct = computed(() => !props.disabled && !reading.value && !working.value && !readingError.value)
const rows = computed(() => review.value?.rows ?? [])
const hasDifferences = computed(() => rows.value.some(row => row.result === 'different'))
const labels: Record<string, string> = {
  invoiceNumber: '发票号码',
  invoiceDate: '开票日期',
  buyer: '购买方',
  buyerTaxNo: '购买方税号',
  seller: '销售方',
  sellerTaxNo: '销售方税号',
  amount: '未税金额',
  taxAmount: '税额',
  totalAmount: '价税合计',
  invoiceType: '发票类型',
  taxRate: '税率',
  items: '明细行数',
  name: '项目名称',
  spec: '规格',
  unit: '单位',
  quantity: '数量',
  unitPrice: '单价',
}
const states = {
  incomplete: '识别缺页或有必需字段未读到，请重新识别原件。',
  different: '原件识别与归档值有差异，请先通过更正单处理，再回来核对。',
  ready: '请对照原件逐项核对，确认后可登记打印。',
  confirmed: '原件已核验，可以按台账的打印条件登记打印。',
  stale: '票据版本已变化，请重新识别当前原件。',
}
const decisions = { match: '一致', missing: '证据不足', different: '有差异' }
let generation = 0
let active = true
function stopReading() {
  active = false
  generation++
  emit('busy', false)
}
onDeactivated(stopReading)
onBeforeUnmount(stopReading)
onActivated(() => {
  active = true
})

function fieldLabel(path: string) {
  const [, index, field] = path.split('.')
  return index === undefined ? labels[path] ?? path : `第 ${Number(index) + 1} 行 ${labels[field!] ?? field}`
}
function display(value: string | number | null) {
  return value === null || value === '' ? '未填写' : value
}
async function load() {
  const ticket = ++generation
  const invoice = props.invoice
  review.value = null
  readingError.value = ''
  reading.value = true
  try {
    const result = await props.workspace.readOriginalVerification(invoice)
    if (active && ticket === generation)
      review.value = result
  }
  catch (cause) {
    if (active && ticket === generation)
      readingError.value = cause instanceof Error ? cause.message : '无法读取核验证据。'
  }
  finally {
    if (active && ticket === generation)
      reading.value = false
  }
}
watch(() => [props.invoice.id, props.invoice.version, props.invoice.original?.sha256, props.workspace], load, { immediate: true })

async function run(kind: 'local' | 'cloud' | 'confirm') {
  if (!canAct.value)
    return
  const invoice = props.invoice
  const verification = review.value
  const workspace = props.workspace
  const ticket = generation
  const stillCurrent = () => active && ticket === generation && props.workspace === workspace && workspace.readState.value === 'ready'
    && props.invoice.id === invoice.id && props.invoice.version === invoice.version && !props.disabled
  if (kind === 'confirm' && (verification?.state !== 'ready' || !props.originalVisible))
    return
  if (kind !== 'local') {
    const approved = await confirm(kind === 'confirm'
      ? { variant: 'simple', title: '确认已逐项核对原件', message: '请确认已查看实际原件，归档值与票号、日期、购销双方、金额及其明细一致。', confirmLabel: '确认原件核验' }
      : { variant: 'simple', title: '确认使用云识别', message: '所选发票原件将发送至已配置的云识别服务。', confirmLabel: '确认发送' })
    if (!approved || !stillCurrent() || working.value)
      return
  }
  working.value = true
  emit('busy', true)
  actionError.value = ''
  try {
    if (kind === 'confirm')
      await workspace.confirmOriginalVerification(invoice, verification!.candidateId, stillCurrent)
    else
      await workspace.recordOriginalVerification(invoice, kind, kind === 'cloud', stillCurrent)
  }
  catch (cause) {
    if (active)
      actionError.value = cause instanceof Error ? cause.message : '原件核验暂时无法完成。'
  }
  finally {
    if (active) {
      working.value = false
      emit('busy', false)
      emit('settled')
    }
  }
}
</script>

<template>
  <section aria-label="已归档发票原件核验" class="min-w-0 space-y-2 border border-line rounded bg-panel p-3 text-sm">
    <h2 class="font-600">
      已归档发票原件核验
    </h2>
    <p v-if="readingError || actionError" role="alert" class="text-danger">
      {{ readingError || actionError }}
    </p>
    <p role="status">
      {{ reading ? '正在读取核验证据…' : working ? '正在处理原件核验…' : review ? states[review.state] : '请识别已关联的原件。' }}
    </p>
    <p v-if="review?.unrecognizedPageIndexes.length">
      未识别页 {{ review.unrecognizedPageIndexes.map(index => index + 1).join('、') }}
    </p>
    <details v-if="review && !reading">
      <summary class="cursor-pointer">
        查看识别和归档值对照（{{ rows.filter(row => row.result !== 'match').length }} 项需核对）
      </summary>
      <div class="mt-2 max-h-64 overflow-auto">
        <table class="w-full min-w-64 text-left">
          <thead>
            <tr><th>字段</th><th>归档值</th><th>识别值</th><th>比对</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.path" class="border-t border-line">
              <th scope="row" class="py-1 pr-2 font-500">
                {{ fieldLabel(row.path) }}
              </th>
              <td class="break-all pr-2">
                {{ display(row.archived) }}
              </td>
              <td class="break-all pr-2">
                {{ display(row.recognized) }}
              </td>
              <td>{{ decisions[row.result] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
    <div class="flex flex-wrap items-center gap-2">
      <button v-if="readingError" type="button" :disabled="disabled || reading" class="border border-line rounded px-2 py-1" @click="load">
        重新读取核验
      </button>
      <button v-if="review?.state !== 'confirmed'" type="button" :disabled="!canAct" class="border border-line rounded px-2 py-1" @click="run('local')">
        识别归档原件
      </button>
      <button v-if="cloudAvailable && review?.state !== 'confirmed'" type="button" :disabled="!canAct" class="border border-line rounded px-2 py-1" @click="run('cloud')">
        使用云识别
      </button>
      <NuxtLink v-if="hasDifferences && canAct && review?.state !== 'confirmed'" :to="`/finance/invoice/correction/${encodeURIComponent(invoice.id)}`" class="text-brand underline">
        前往更正单
      </NuxtLink>
      <button v-if="review?.state === 'ready'" type="button" :disabled="!canAct || !originalVisible" class="border border-line rounded px-2 py-1" @click="run('confirm')">
        确认原件核验
      </button>
    </div>
  </section>
</template>
