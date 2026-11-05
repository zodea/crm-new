<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { computed, ref, shallowRef, watch } from 'vue'
import { centralInvoiceSourceLabel } from '~/lib/invoice/central-source-label'
import { isISODateDTO } from '~/types/read-model'

interface ReferenceOption { id: string, label: string }
const props = defineProps<{ records: readonly CentralInvoiceRecord[], projects: readonly ReferenceOption[], busy?: boolean }>()
const emit = defineEmits<{ open: [id: string], discard: [id: string], preparePrint: [records: CentralInvoiceRecord[]], export: [records: CentralInvoiceRecord[]] }>()
const search = ref('')
const owner = ref('all')
const startDate = shallowRef('')
const endDate = shallowRef('')
const startDateBadInput = shallowRef(false)
const endDateBadInput = shallowRef(false)
const checked = ref<string[]>([])
const dateError = computed(() => {
  if (startDateBadInput.value || endDateBadInput.value || (startDate.value && !isISODateDTO(startDate.value)) || (endDate.value && !isISODateDTO(endDate.value)))
    return '请输入有效的开票日期。'
  if (startDate.value && endDate.value && startDate.value > endDate.value)
    return '开始日期不能晚于结束日期。'
  return ''
})
const archived = computed(() => props.records.filter(record => record.accountStatus === 'archived' && record.deletedAt === null))
const options = computed(() => props.projects.map(project => ({ ...project, count: archived.value.filter(record => record.projectId === project.id).length })))
const visible = computed(() => {
  if (dateError.value)
    return []
  const needle = search.value.trim().toLocaleLowerCase()
  return archived.value.filter((record) => {
    if (owner.value === 'personal' && record.ownerKind !== 'personal')
      return false
    if (owner.value === '__company__' && record.ownerKind !== 'company')
      return false
    if (owner.value !== 'all' && owner.value !== 'personal' && owner.value !== '__company__' && record.projectId !== owner.value)
      return false
    if (startDate.value || endDate.value) {
      const date = record.fields.invoiceDate
      if (!isISODateDTO(date) || (startDate.value && date < startDate.value) || (endDate.value && date > endDate.value))
        return false
    }
    const projectName = props.projects.find(project => project.id === record.projectId)?.label ?? ''
    return !needle || [record.fields.invoiceNumber, record.fields.buyer, record.fields.seller, record.fields.remark, projectName].some(value => value.toLocaleLowerCase().includes(needle))
  })
})
function updateDate(event: Event, boundary: 'start' | 'end') {
  const input = event.target as HTMLInputElement
  const value = boundary === 'start' ? startDate : endDate
  const badInput = boundary === 'start' ? startDateBadInput : endDateBadInput
  value.value = input.value
  badInput.value = input.validity.badInput
}
const selected = computed(() => archived.value.filter(record => checked.value.includes(record.id)))
const total = computed(() => {
  let cents = 0
  for (const record of selected.value) {
    if (record.fields.totalAmount === null)
      return null
    const amount = Math.round(record.fields.totalAmount * 100)
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(cents + amount))
      return null
    cents += amount
  }
  return cents / 100
})
const invalidPrint = computed(() => selected.value.filter(record => record.sourceKind !== 'scan' || !record.original || record.ocrStatus !== 'done' || record.reviewStatus !== 'reviewed' || record.duplicateStatus !== 'normal' || record.fields.totalAmount === null || record.fields.totalAmount <= 0))
watch(archived, (rows) => {
  checked.value = checked.value.filter(id => rows.some(record => record.id === id))
})
function projectLabel(record: CentralInvoiceRecord) {
  if (record.ownerKind === 'personal')
    return '个人开支'
  if (record.ownerKind === 'company')
    return '公司开销'
  if (!record.projectId)
    return '归属待核实'
  return props.projects.find(project => project.id === record.projectId)?.label ?? '项目来源不可用'
}
function print() {
  if (selected.value.length && !invalidPrint.value.length)
    emit('preparePrint', selected.value)
}
function exportVisible() {
  if (!props.busy && !dateError.value && visible.value.length)
    emit('export', visible.value)
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-3 p-3" aria-label="发票台账">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-lg font-700">
        发票台账
      </h1>
      <button type="button" :disabled="busy || !visible.length" class="rounded border border-line px-3 py-1 text-sm" @click="exportVisible">
        导出 Excel
      </button>
      <button type="button" :disabled="busy || !selected.length || !!invalidPrint.length" class="rounded border border-line px-3 py-1 text-sm" @click="print">
        打印所选
      </button>
    </div>
    <div class="flex flex-wrap gap-3">
      <label class="flex flex-col gap-1 text-sm">搜索发票<input v-model="search" class="rounded border border-line bg-surface px-2 py-1" placeholder="号码、购销方、项目或备注"></label>
      <label class="flex flex-col gap-1 text-sm">归属<select v-model="owner" class="rounded border border-line bg-surface px-2 py-1">
        <option value="all">全部（{{ archived.length }}）</option>
        <option value="personal">个人开支</option>
        <option value="__company__">公司开销</option>
        <option v-for="project in options" :key="project.id" :value="project.id">{{ project.label }}（{{ project.count }}） · {{ project.id }}</option>
      </select></label>
      <label class="flex flex-col gap-1 text-sm">开票开始日期<input :value="startDate" type="date" :aria-invalid="!!dateError" :aria-describedby="dateError ? 'invoice-date-error' : 'invoice-date-hint'" class="rounded border border-line bg-surface px-2 py-1" @input="updateDate($event, 'start')" @change="updateDate($event, 'start')"></label>
      <label class="flex flex-col gap-1 text-sm">开票结束日期<input :value="endDate" type="date" :aria-invalid="!!dateError" :aria-describedby="dateError ? 'invoice-date-error' : 'invoice-date-hint'" class="rounded border border-line bg-surface px-2 py-1" @input="updateDate($event, 'end')" @change="updateDate($event, 'end')"></label>
    </div>
    <p v-if="dateError" id="invoice-date-error" role="alert" class="text-sm text-danger">
      {{ dateError }}
    </p>
    <p v-else id="invoice-date-hint" class="text-sm text-ink-soft">
      设置日期范围时，日期未填写的发票不计入筛选结果。
    </p>
    <p v-if="selected.length" role="status" class="text-sm text-ink-soft">
      已选 {{ selected.length }} 张 · {{ total === null ? '合计未统计（金额缺失或超出范围）' : `合计 ${total.toFixed(2)}` }}
    </p>
    <p v-if="invalidPrint.length" class="text-sm text-warn-ink">
      所选中 {{ invalidPrint.length }} 张尚不满足打印条件，请先核对或取消选择。
    </p>
    <div class="min-h-0 flex-1 overflow-auto rounded border border-line bg-panel">
      <table class="w-full min-w-180 text-left text-sm">
        <thead class="sticky top-0 bg-panel">
          <tr>
            <th class="p-2">
              选择
            </th><th class="p-2">
              发票号码
            </th><th class="p-2">
              日期
            </th><th class="p-2">
              销售方
            </th><th class="p-2">
              价税合计
            </th><th class="p-2">
              归属
            </th><th class="p-2">
              来源
            </th><th class="p-2">
              打印
            </th><th class="p-2">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in visible" :key="record.id" class="border-t border-line">
            <td class="p-2">
              <input v-model="checked" type="checkbox" :value="record.id" :aria-label="`选择发票 ${record.fields.invoiceNumber || record.id}`" :disabled="busy">
            </td>
            <td class="p-2">
              <button type="button" class="text-brand" @click="emit('open', record.id)">
                {{ record.fields.invoiceNumber || '未填写' }}
              </button>
            </td>
            <td class="p-2">
              {{ record.fields.invoiceDate || '未填写' }}
            </td>
            <td class="p-2">
              {{ record.fields.seller || '未填写' }}
            </td>
            <td class="p-2">
              {{ record.fields.totalAmount === null ? '未填写' : record.fields.totalAmount.toFixed(2) }}
            </td>
            <td class="p-2">
              {{ projectLabel(record) }}
            </td>
            <td class="p-2">
              {{ centralInvoiceSourceLabel(record) }}
            </td>
            <td class="p-2">
              {{ record.printCount ? `已打印 ${record.printCount} 次` : '未打印' }}
            </td>
            <td class="p-2">
              <NuxtLink v-if="!busy" :to="`/finance/invoice/correction/${encodeURIComponent(record.id)}`" :aria-label="`更正发票 ${record.fields.invoiceNumber || record.id}`" class="mr-3 text-brand underline">
                更正
              </NuxtLink>
              <button type="button" :disabled="busy" class="text-danger" @click="emit('discard', record.id)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!dateError && !visible.length" class="p-4 text-sm text-ink-soft">
        当前筛选下没有发票。
      </p>
    </div>
  </section>
</template>
