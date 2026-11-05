<script setup lang="ts">
import type { CentralInvoiceFields, CentralInvoiceItem, CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import type { CentralInvoiceFormSnapshot } from '~/lib/invoice/central-form-snapshot'
import { reactive, ref, shallowRef, watch } from 'vue'

const props = defineProps<{ record: CentralInvoiceRecord, baseline?: CentralInvoiceRecord | null, baselineSnapshot?: CentralInvoiceFormSnapshot | null, restoredSnapshot?: CentralInvoiceFormSnapshot | null, busy?: boolean, lockActions?: boolean, disableSave?: boolean, correctionMode?: boolean, locationKeys?: readonly string[] }>()
const emit = defineEmits<{
  save: [payload: { invoiceId: string, baseVersion: string, fields: CentralInvoiceFields, items: CentralInvoiceItem[] }]
  review: [manualCompletion: boolean]
  discard: []
  dirty: [value: boolean]
  locate: [key: string]
  preview: [key: string | null]
  release: [key: string]
}>()
const textFields = [
  ['invoiceNumber', '发票号码'],
  ['invoiceDate', '开票日期'],
  ['invoiceType', '发票类型'],
  ['buyer', '购买方'],
  ['buyerTaxNo', '购买方税号'],
  ['seller', '销售方'],
  ['sellerTaxNo', '销售方税号'],
  ['taxRate', '税率'],
  ['remark', '备注'],
] as const
const moneyFields = [['amount', '不含税金额'], ['taxAmount', '税额'], ['totalAmount', '价税合计']] as const
const itemNumberFields = [['quantity', '数量'], ['unitPrice', '单价'], ['amount', '金额'], ['taxAmount', '税额']] as const
type ItemDraft = Omit<CentralInvoiceItem, 'quantity' | 'unitPrice' | 'amount' | 'taxAmount'> & { quantity: string, unitPrice: string, amount: string, taxAmount: string }
const fields = ref<CentralInvoiceFields>({ ...props.record.fields })
const money = reactive<Record<typeof moneyFields[number][0], string>>({ amount: '', taxAmount: '', totalAmount: '' })
const items = ref<ItemDraft[]>([])
const baseVersion = shallowRef(props.record.version)
const changed = shallowRef(false)
const error = shallowRef('')
const stale = shallowRef(false)
let restoredOnce = false

function display(value: number | null) {
  return value === null ? '' : String(value)
}
function reset() {
  const restored = !restoredOnce && props.restoredSnapshot?.invoiceId === props.record.id ? props.restoredSnapshot : null
  if (restored) {
    restoredOnce = true
    fields.value = { ...restored.fields }
    Object.assign(money, restored.money)
    items.value = restored.items.map(item => ({ ...item }))
    baseVersion.value = restored.baseVersion
    changed.value = restored.dirty
    stale.value = props.record.version !== restored.baseVersion
    error.value = ''
    emit('dirty', restored.dirty)
    return
  }
  fields.value = { ...props.record.fields }
  for (const [key] of moneyFields) money[key] = display(props.record.fields[key])
  items.value = props.record.items.map(item => ({ ...item, quantity: display(item.quantity), unitPrice: display(item.unitPrice), amount: display(item.amount), taxAmount: display(item.taxAmount) }))
  baseVersion.value = props.record.version
  changed.value = false
  stale.value = false
  error.value = ''
  emit('dirty', false)
}
function capture(): CentralInvoiceFormSnapshot {
  return { invoiceId: props.record.id, baseVersion: baseVersion.value, fields: { ...fields.value }, money: { ...money }, items: items.value.map(item => ({ ...item })), dirty: changed.value }
}
defineExpose({ capture })
watch(() => props.record.id, reset, { immediate: true })
watch(() => props.record.version, () => {
  if (!changed.value) {
    reset()
    return
  }
  try {
    const nextFields = { ...fields.value }
    for (const [key] of moneyFields) nextFields[key] = numberOrNull(money[key])
    const nextItems = items.value.map(item => ({ ...item, quantity: numberOrNull(item.quantity), unitPrice: numberOrNull(item.unitPrice), amount: numberOrNull(item.amount), taxAmount: numberOrNull(item.taxAmount) }))
    if (JSON.stringify(nextFields) === JSON.stringify(props.record.fields) && JSON.stringify(nextItems) === JSON.stringify(props.record.items)) {
      reset()
      return
    }
  }
  catch { /* 不完整输入留在页面，不能当作保存成功 */ }
  stale.value = props.record.version !== baseVersion.value
})
function markChanged() {
  changed.value = true
  error.value = ''
  emit('dirty', true)
}
function numberOrNull(value: string) {
  if (!value.trim())
    return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1_000_000_000_000)
    throw new Error('请检查金额、数量或单价。')
  return parsed
}
function mark(key: keyof CentralInvoiceFields) {
  if (!props.baseline && !props.baselineSnapshot)
    return null
  let current: string | number | null = fields.value[key]
  if (key === 'amount' || key === 'taxAmount' || key === 'totalAmount') {
    try {
      current = numberOrNull(money[key])
    }
    catch { return '已人工修改' }
  }
  if (current !== props.record.fields[key])
    return '已人工修改'
  const before = props.baselineSnapshot
    ? key === 'amount' || key === 'taxAmount' || key === 'totalAmount'
      ? numericBaseline(props.baselineSnapshot.money[key])
      : props.baselineSnapshot.fields[key]
    : props.baseline!.fields[key]
  return props.record.fields[key] !== before ? '识别变动' : null
}
function numericBaseline(value: string): string | number | null {
  if (!value.trim())
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : value
}
function original(key: keyof CentralInvoiceFields) {
  const value = props.baselineSnapshot
    ? key === 'amount' || key === 'taxAmount' || key === 'totalAmount' ? props.baselineSnapshot.money[key] : props.baselineSnapshot.fields[key]
    : props.baseline?.fields[key]
  return value === null || value === undefined || value === '' ? '未填写' : String(value)
}
function save() {
  if (stale.value) {
    error.value = '发票已在其他位置更新，请先核对最新版本；当前输入仍保留。'
    return
  }
  try {
    const nextFields = { ...fields.value }
    for (const [key] of moneyFields) nextFields[key] = numberOrNull(money[key])
    const nextItems = items.value.map(item => ({ ...item, quantity: numberOrNull(item.quantity), unitPrice: numberOrNull(item.unitPrice), amount: numberOrNull(item.amount), taxAmount: numberOrNull(item.taxAmount) }))
    emit('save', { invoiceId: props.record.id, baseVersion: baseVersion.value, fields: nextFields, items: nextItems })
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '输入无效。' }
}
function addItem() {
  items.value.push({ name: '', spec: '', unit: '', quantity: '', unitPrice: '', amount: '', taxRate: '', taxAmount: '' })
  markChanged()
}
</script>

<template>
  <section class="min-w-0 overflow-y-auto rounded border border-line bg-panel p-4" aria-label="发票校对">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-700">
        核对发票
      </h2>
      <span class="text-sm text-ink-soft">{{ record.reviewStatus === 'reviewed' ? '已核对' : '待核对' }} · {{ record.accountStatus === 'archived' ? '已归档' : '未归档' }}</span>
    </div>
    <p v-if="record.unrecognizedPageIndexes.length" role="status" class="mb-3 text-sm text-warn-ink">
      未识别页：{{ record.unrecognizedPageIndexes.map(page => page + 1).join('、') }}。请对照原件补全后确认。
    </p>
    <p v-if="stale" role="alert" class="mb-3 text-sm text-danger">
      其他位置已更新这张发票，当前输入仍保留，请先核对最新版本。
    </p>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label v-for="[key, label] in textFields" :key="key" class="flex min-w-0 flex-col gap-1 text-sm">
        <span>{{ label }} <small v-if="mark(key)" class="text-warn-ink">{{ mark(key) }}（原值：{{ original(key) }}）</small></span>
        <input v-model="fields[key]" :type="key === 'invoiceDate' ? 'date' : 'text'" :disabled="busy" :aria-description="locationKeys ? (locationKeys.includes(key) ? '原图可定位' : '原图未定位') : undefined" class="min-w-0 border border-line rounded bg-surface px-2 py-1" :class="mark(key) ? 'border-warn!' : ''" @input="markChanged" @focus="emit('locate', key)" @blur="emit('release', key)" @mouseenter="emit('preview', key)" @mouseleave="emit('preview', null)">
      </label>
      <label v-for="[key, label] in moneyFields" :key="key" class="flex min-w-0 flex-col gap-1 text-sm">
        <span>{{ label }} <small v-if="mark(key)" class="text-warn-ink">{{ mark(key) }}（原值：{{ original(key) }}）</small></span>
        <input v-model="money[key]" type="text" inputmode="decimal" :disabled="busy" :aria-description="locationKeys ? (locationKeys.includes(key) ? '原图可定位' : '原图未定位') : undefined" placeholder="未填写" class="min-w-0 border border-line rounded bg-surface px-2 py-1" :class="mark(key) ? 'border-warn!' : ''" @input="markChanged" @focus="emit('locate', key)" @blur="emit('release', key)" @mouseenter="emit('preview', key)" @mouseleave="emit('preview', null)">
      </label>
    </div>
    <details class="mt-4">
      <summary class="cursor-pointer font-600">
        货物明细（{{ items.length }}）
      </summary>
      <div v-for="(item, index) in items" :key="index" class="mt-3 border border-line rounded p-3">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label v-for="[key, label] in [['name', '名称'], ['spec', '规格'], ['unit', '单位'], ['taxRate', '税率']] as const" :key="key" class="flex flex-col gap-1 text-sm">
            <span>第 {{ index + 1 }} 行{{ label }}</span>
            <input v-model="item[key]" :disabled="busy" class="min-w-0 border border-line rounded bg-surface px-2 py-1" @input="markChanged">
          </label>
          <label v-for="[key, label] in itemNumberFields" :key="key" class="flex flex-col gap-1 text-sm">
            <span>第 {{ index + 1 }} 行{{ label }}</span>
            <input v-model="item[key]" type="text" inputmode="decimal" :disabled="busy" placeholder="未填写" class="min-w-0 border border-line rounded bg-surface px-2 py-1" @input="markChanged">
          </label>
        </div>
        <button type="button" :disabled="busy" class="mt-2 text-danger" @click="items.splice(index, 1); markChanged()">
          删除第 {{ index + 1 }} 行
        </button>
      </div>
      <button type="button" :disabled="busy" class="mt-3 text-brand" @click="addItem">
        添加明细
      </button>
    </details>
    <p v-if="error" role="alert" class="mt-3 text-sm text-danger">
      {{ error }}
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      <button type="button" :disabled="busy || disableSave || !changed || stale" class="border border-line rounded px-3 py-1" @click="save">
        {{ correctionMode ? '应用票面修改' : '保存修改' }}
      </button>
      <button v-if="record.reviewStatus === 'unreviewed'" type="button" :disabled="busy || changed || lockActions" class="border border-line rounded px-3 py-1" @click="emit('review', record.ocrStatus !== 'done')">
        {{ record.ocrStatus === 'done' ? '确认已核对' : '确认人工补全' }}
      </button>
      <button v-if="!correctionMode" type="button" :disabled="busy || changed || lockActions" class="border border-line rounded px-3 py-1 text-danger" @click="emit('discard')">
        废弃发票
      </button>
    </div>
  </section>
</template>
