<script setup lang="ts">
import type { CentralInvoiceFields, CentralInvoiceItem } from '~/lib/invoice/central-contract'
import type { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import { onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useKitUI } from '~/composables/useKitUI'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'

const props = defineProps<{ workspace: ReturnType<typeof createCentralInvoiceWorkspace> }>()
const emit = defineEmits<{ saved: [id: string] }>()
const { confirm } = useKitUI()
const fields = reactive<CentralInvoiceFields>({ invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' })
const money = reactive({ amount: '', taxAmount: '', totalAmount: '' })
type ItemDraft = Omit<CentralInvoiceItem, 'quantity' | 'unitPrice' | 'amount' | 'taxAmount'> & { quantity: string, unitPrice: string, amount: string, taxAmount: string }
const items = ref<ItemDraft[]>([])
const textFields = [['invoiceNumber', '发票号码'], ['invoiceDate', '开票日期'], ['invoiceType', '发票类型'], ['buyer', '购买方'], ['buyerTaxNo', '购买方税号'], ['seller', '销售方'], ['sellerTaxNo', '销售方税号'], ['taxRate', '税率'], ['remark', '备注']] as const
const moneyFields = [['amount', '不含税金额'], ['taxAmount', '税额'], ['totalAmount', '价税合计']] as const
const itemNumberFields = [['quantity', '数量'], ['unitPrice', '单价'], ['amount', '金额'], ['taxAmount', '税额']] as const
const busy = shallowRef(false)
const dirty = shallowRef(false)
const error = shallowRef('')
const notice = shallowRef('')
const pending = shallowRef<{ action: string, targetId: string | null, scopeId?: string } | null>(null)
const pendingUnavailable = shallowRef(true)
const completed = shallowRef<string | null>(null)
function refreshPending() {
  try {
    if (props.workspace.readState.value !== 'ready')
      throw new Error('发票来源尚不可用，请重新读取。')
    pending.value = props.workspace.pendingAll()[0] ?? null
    pendingUnavailable.value = false
  }
  catch (cause) {
    pending.value = null
    pendingUnavailable.value = true
    error.value = cause instanceof Error ? cause.message : '无法核对原提交编号。'
  }
}
watch(() => props.workspace, refreshPending)
watch(() => props.workspace.readState.value, refreshPending)
onMounted(refreshPending)
function numberOrNull(value: string) {
  if (!value.trim())
    return null
  const number = Number(value)
  if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000)
    throw new Error('请检查金额、数量或单价。')
  return number
}
async function mayLeave() {
  if (!dirty.value)
    return true
  if (busy.value)
    return false
  return confirm({ variant: 'simple', title: '放弃未保存的发票', message: '当前手工录入尚未保存。确定放弃并离开吗？', confirmLabel: '放弃修改' })
}
useTabCloseGuard(mayLeave)
onBeforeRouteLeave(mayLeave)
onBeforeRouteUpdate((to, from) => to.fullPath === from.fullPath ? true : mayLeave())
async function save() {
  if (busy.value || completed.value || pending.value || pendingUnavailable.value)
    return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const nextFields = { ...fields, amount: numberOrNull(money.amount), taxAmount: numberOrNull(money.taxAmount), totalAmount: numberOrNull(money.totalAmount) }
    const nextItems = items.value.map(item => ({ ...item, quantity: numberOrNull(item.quantity), unitPrice: numberOrNull(item.unitPrice), amount: numberOrNull(item.amount), taxAmount: numberOrNull(item.taxAmount) }))
    const saved = await props.workspace.manual(nextFields, nextItems)
    dirty.value = false
    completed.value = saved.id
    emit('saved', saved.id)
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存暂不可用，请保留输入。' }
  finally {
    busy.value = false
    refreshPending()
  }
}
async function recover() {
  if (busy.value || !pending.value || pending.value.scopeId !== undefined)
    return
  const { action, targetId } = pending.value
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await props.workspace.recover(targetId)
    if (result?.outcome === 'applied' && action === 'manual' && targetId === null) {
      dirty.value = false
      completed.value = result.read.record.id
      emit('saved', result.read.record.id)
    }
    else if (result?.outcome === 'not-applied') {
      notice.value = '上次提交经核对未生效，请检查当前输入后重新保存。刷新页面后请重新填写需要的内容。'
    }
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '原提交暂无法核对。' }
  finally {
    busy.value = false
    refreshPending()
  }
}
</script>

<template>
  <section class="h-full overflow-auto p-4" aria-label="手工新建发票">
    <div class="mx-auto max-w-4xl">
      <h1 class="text-lg font-700">
        手工新建发票
      </h1>
      <p class="my-3 text-sm text-ink-soft">
        保存后为草稿，核对并选择项目或公司开销及相关资料后才能归档。税号缺失可先保存草稿，请联系厂家重开。
      </p>
      <div v-if="pending" role="status" class="mb-3">
        上次提交结果尚未核对，不能换编号重复提交。
        <button v-if="pending.scopeId === undefined" type="button" :disabled="busy" class="rounded border border-line px-3 py-1" @click="recover">
          核对上次提交
        </button>
        <NuxtLink v-else-if="pending.targetId" :to="`/finance/invoice/correction/${encodeURIComponent(pending.targetId)}`" class="underline">
          前往更正单核对原提交
        </NuxtLink>
      </div>
      <p v-if="error" role="alert" class="mb-3 text-danger">
        {{ error }}
      </p>
      <p v-if="notice" role="status" class="mb-3 text-sm">
        {{ notice }}
      </p>
      <fieldset class="m-0 min-w-0 border-0 p-0" :disabled="busy || !!pending || pendingUnavailable || !!completed">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2" @input="dirty = true">
          <label v-for="[key, label] in textFields" :key="key" class="flex min-w-0 flex-col gap-1 text-sm">
            {{ label }}<input v-model="fields[key]" :type="key === 'invoiceDate' ? 'date' : 'text'" :disabled="busy" class="min-w-0 border border-line rounded bg-surface px-2 py-1">
          </label>
          <label v-for="[key, label] in moneyFields" :key="key" class="flex min-w-0 flex-col gap-1 text-sm">
            {{ label }}<input v-model="money[key]" type="text" inputmode="decimal" :disabled="busy" placeholder="未填写" class="min-w-0 border border-line rounded bg-surface px-2 py-1">
          </label>
        </div>
        <details class="mt-4">
          <summary class="cursor-pointer font-600">
            货物明细（{{ items.length }}）
          </summary>
          <div v-for="(item, index) in items" :key="index" class="mt-3 border border-line rounded p-3" @input="dirty = true">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label v-for="[key, label] in [['name', '名称'], ['spec', '规格'], ['unit', '单位'], ['taxRate', '税率']] as const" :key="key" class="flex min-w-0 flex-col gap-1 text-sm">第 {{ index + 1 }} 行{{ label }}<input v-model="item[key]" :disabled="busy" class="min-w-0 border border-line rounded bg-surface px-2 py-1"></label>
              <label v-for="[key, label] in itemNumberFields" :key="key" class="flex min-w-0 flex-col gap-1 text-sm">第 {{ index + 1 }} 行{{ label }}<input v-model="item[key]" type="text" inputmode="decimal" :disabled="busy" class="min-w-0 border border-line rounded bg-surface px-2 py-1"></label>
            </div>
            <button type="button" :disabled="busy" class="mt-2 text-danger" @click="items.splice(index, 1); dirty = true">
              删除第 {{ index + 1 }} 行
            </button>
          </div>
          <button type="button" :disabled="busy" class="mt-3 text-brand" @click="items.push({ name: '', spec: '', unit: '', quantity: '', unitPrice: '', amount: '', taxRate: '', taxAmount: '' }); dirty = true">
            添加明细
          </button>
        </details>
      </fieldset>
      <button v-if="completed" type="button" class="mt-4 rounded border border-line px-3 py-2" @click="emit('saved', completed)">
        继续核对已保存草稿
      </button>
      <button v-else type="button" :disabled="busy || !!pending || pendingUnavailable" class="mt-4 rounded border border-line px-3 py-2" @click="save">
        保存草稿
      </button>
    </div>
  </section>
</template>
