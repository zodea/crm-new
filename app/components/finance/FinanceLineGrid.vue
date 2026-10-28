<script setup lang="ts">
import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type {
  InvoiceAllocationDraft,
  PaymentApplicationAllocationDraft,
  ReimbursementLineDraft,
  SettlementAllocationDraft,
} from '~/lib/finance/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import type { KitTableColumn } from '~/lib/kit/table'
import { useFullscreen } from '@vueuse/core'
import { computed, onBeforeUnmount, onDeactivated, reactive, shallowRef, watch } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import KitTable from '~/components/ui/KitTable.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { useToast } from '~/composables/useToast'
import { financeInputTextNumber, financeInputNumber as inputNumber } from '~/lib/finance/input-number'
import { forgetFinanceLineIdentity } from '~/lib/finance/input-snapshot'

type GridKind = 'reimbursement' | 'settlement' | 'invoice' | 'payment'
type GridLine
  = Partial<ReimbursementLineDraft>
    & Partial<SettlementAllocationDraft>
    & Partial<InvoiceAllocationDraft>
    & Partial<PaymentApplicationAllocationDraft>

const props = defineProps<{
  kind: GridKind
  lines: GridLine[]
  fetchOptions?: (keyword: string) => Promise<LookupOption[]>
  fetchCounterparties?: (keyword: string) => Promise<LookupOption[]>
  fetchOriginalExpenses?: (keyword: string) => Promise<LookupOption[]>
  fetchConstructionMains?: (keyword: string) => Promise<Array<LookupOption & { constructionMain: ConstructionMainSelection }>>
  defaultConstructionMain?: ConstructionMainSelection
  disabledReason?: string
  totalLabel: string
  empty: string
}>()

const emit = defineEmits<{
  update: [lines: GridLine[]]
}>()
const toast = useToast()
let engineeringContext = 0
let engineeringSelection = 0
const engineeringRequests = new WeakMap<GridLine, number>()
watch(() => [props.kind, props.fetchConstructionMains, props.defaultConstructionMain?.projectId], () => engineeringContext++, { flush: 'sync' })
onDeactivated(() => engineeringContext++)
onBeforeUnmount(() => engineeringContext++)

const root = shallowRef<HTMLElement | null>(null)
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(root)
const importing = shallowRef(false)
const tsv = shallowRef('')

const tableRows = shallowRef<Array<GridLine & { formRowKey: string }>>([])
const displayFields = new WeakMap<GridLine, Set<string>>()
watch(() => props.lines, (lines) => {
  const keys = lines.map((line, index) => line.id ?? `draft-${index}`)
  const previous = new Map(tableRows.value.map(row => [row.formRowKey, row]))
  const next = lines.map((line, index) => {
    const key = keys[index]!
    const row = previous.get(key)
    if (row) {
      for (const field of displayFields.get(row) ?? []) {
        if (!Object.hasOwn(line, field))
          Reflect.deleteProperty(row, field)
      }
      Object.assign(row, line)
      displayFields.set(row, new Set(Object.keys(line)))
      return row
    }
    const created = reactive({ ...line, formRowKey: key })
    displayFields.set(created, new Set(Object.keys(line)))
    return created
  })
  // vxe reloads the entire body for a new data array. Updating existing display
  // rows keeps the searchable picker and focused input mounted while editing.
  if (next.length !== tableRows.value.length || next.some((row, index) => row !== tableRows.value[index]))
    tableRows.value = next
}, { immediate: true, deep: true })

const sourceTitle = computed(() => ({
  reimbursement: '费用项目',
  settlement: '结算单',
  invoice: '发票',
  payment: '付款申请',
})[props.kind])

const columns = computed<KitTableColumn[]>(() => [
  { field: 'source', title: sourceTitle.value, minWidth: 240, slot: 'source' },
  ...(props.kind === 'reimbursement'
    ? [{ field: 'date', title: '发生日期', width: 150, slot: 'date' } satisfies KitTableColumn, { field: 'counterparty', title: '实际交易方', minWidth: 240, slot: 'counterparty' } satisfies KitTableColumn, { field: 'original', title: '清偿已记录垫款', minWidth: 240, slot: 'original' } satisfies KitTableColumn]
    : []),
  ...(props.kind === 'reimbursement' && props.fetchConstructionMains ? [{ field: 'constructionMain', title: '工程名称 / 施工合同', minWidth: 260, slot: 'constructionMain' } satisfies KitTableColumn] : []),
  { field: 'amount', title: '金额', width: 160, align: 'right', slot: 'amount' },
  { field: 'note', title: '备注', minWidth: 180, slot: 'note' },
  { type: 'action', title: '操作', width: 92, align: 'center', slot: 'action' },
])
const gridMinWidth = computed(() =>
  columns.value.reduce((width, column) => width + (column.width ?? column.minWidth ?? 0), 0),
)

function sourceId(line: GridLine): string | null | undefined {
  if (props.kind === 'settlement')
    return line.settlementId
  if (props.kind === 'invoice')
    return line.invoiceId
  return line.paymentApplicationId
}

function patch(index: number, value: Partial<GridLine>) {
  emit('update', props.lines.map((line, current) =>
    current === index ? { ...line, ...value } : line,
  ))
}

function patchSource(index: number, value: string | null) {
  const key = props.kind === 'settlement'
    ? 'settlementId'
    : props.kind === 'invoice'
      ? 'invoiceId'
      : 'paymentApplicationId'
  patch(index, { [key]: value } as Partial<GridLine>)
}
async function selectConstructionMain(index: number, id: string | null) {
  const line = props.lines[index]
  if (!line)
    return
  const context = engineeringContext
  const selection = ++engineeringSelection
  const fetch = props.fetchConstructionMains
  engineeringRequests.set(line, selection)
  if (!id || !fetch) {
    patch(index, { constructionMain: undefined })
    return
  }
  const current = () => context === engineeringContext && props.lines[index] === line && engineeringRequests.get(line) === selection
  try {
    const selected = (await fetch(id)).find(row => row.id === id)?.constructionMain
    if (current() && selected)
      patch(index, { constructionMain: selected })
  }
  catch (error) {
    if (current())
      toast.error('费用工程选择未完成', error instanceof Error ? error.message : '请重试读取工程资格。')
  }
}

function emptyLine(): GridLine {
  if (props.kind === 'reimbursement') {
    return {
      expenseItem: '',
      expenseDate: '',
      amount: 0,
      note: '',
    } as GridLine
  }
  const key = props.kind === 'settlement'
    ? 'settlementId'
    : props.kind === 'invoice'
      ? 'invoiceId'
      : 'paymentApplicationId'
  return {
    [key]: null,
    allocatedAmount: 0,
    note: '',
  } as GridLine
}

function add() {
  emit('update', [...props.lines, emptyLine()])
}

function copy(index: number) {
  const next = [...props.lines]
  const copied = { ...props.lines[index], id: undefined }
  forgetFinanceLineIdentity(copied)
  next.splice(index + 1, 0, copied)
  emit('update', next)
}

function remove(index: number) {
  emit('update', props.lines.filter((_, current) => current !== index))
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function importTsv() {
  const imported = tsv.value
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map((line) => {
      const [source = '', dateOrAmount = '', amountOrNote = '', note = ''] = line.split('\t')
      if (props.kind === 'reimbursement') {
        return {
          expenseItem: source.trim(),
          expenseDate: dateOrAmount.trim(),
          amount: financeInputTextNumber(amountOrNote),
          note: note.trim(),
        } as GridLine
      }
      const key = props.kind === 'settlement'
        ? 'settlementId'
        : props.kind === 'invoice'
          ? 'invoiceId'
          : 'paymentApplicationId'
      return {
        [key]: source.trim() || null,
        allocatedAmount: financeInputTextNumber(dateOrAmount),
        note: amountOrNote.trim(),
      } as GridLine
    })
  emit('update', [...props.lines, ...imported])
  tsv.value = ''
  importing.value = false
}
</script>

<template>
  <section
    ref="root"
    class="flex min-h-0 flex-col bg-panel"
    :class="{ 'h-screen p-4': isFullscreen }"
    data-testid="finance-line-grid"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <span class="font-mono text-12px font-700 text-brand-deep">{{ totalLabel }}</span>
      <div class="ml-auto flex flex-wrap gap-2">
        <KitButton size="sm" variant="secondary" data-testid="import-grid-tsv" @click="importing = !importing">
          <span class="i-lucide-clipboard-paste mr-1" aria-hidden="true" />粘贴导入
        </KitButton>
        <KitButton size="sm" variant="secondary" data-testid="toggle-grid-fullscreen" @click="toggleFullscreen">
          <span :class="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="mr-1" aria-hidden="true" />
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </KitButton>
        <KitButton size="sm" variant="secondary" data-testid="add-grid-line" @click="add">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新增行
        </KitButton>
      </div>
    </div>

    <div v-if="importing" class="grid gap-2 border-b border-line bg-surface-2 p-3">
      <p class="text-12px text-ink-soft">
        {{ kind === 'reimbursement' ? '每行：费用项目、发生日期、金额、备注' : `每行：${sourceTitle} ID、金额、备注` }}，字段间用 Tab 分隔。
      </p>
      <textarea v-model="tsv" rows="4" class="field-input w-full font-mono" data-testid="grid-tsv-input" />
      <div class="flex justify-end gap-2">
        <KitButton size="sm" variant="secondary" @click="importing = false">
          取消
        </KitButton>
        <KitButton size="sm" :disabled="!tsv.trim()" data-testid="confirm-grid-import" @click="importTsv">
          导入
        </KitButton>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <KitTable :style="{ minWidth: `${gridMinWidth}px` }" :columns="columns" :data="tableRows" row-key="formRowKey" :min-rows="3" :empty="empty">
        <template #source="{ row, rowIndex }">
          <input
            v-if="kind === 'reimbursement'"
            :value="row.expenseItem"
            class="field-input w-full"
            :data-testid="`reimbursement-item-${rowIndex}`"
            @input="patch(rowIndex, { expenseItem: inputValue($event) })"
          >
          <LookupSelect
            v-else
            :model-value="sourceId(row)"
            :fetch="fetchOptions!"
            :recent-key="`finance-${kind}-${rowIndex}`"
            :disabled-reason="disabledReason"
            :placeholder="`选择${sourceTitle}`"
            @update:model-value="patchSource(rowIndex, $event)"
          />
        </template>
        <template #original="{ row, rowIndex }">
          <LookupSelect v-if="fetchOriginalExpenses" :model-value="row.originalExpenseLineId" :fetch="fetchOriginalExpenses" placeholder="新费用留空；清偿选择原费用" @update:model-value="patch(rowIndex, { originalExpenseLineId: $event })" />
          <p v-if="row.originalExpenseLineId" class="text-12px text-ink-soft">
            原费用身份：{{ row.originalExpenseLineId }}
          </p>
        </template>
        <template #constructionMain="{ row, rowIndex }">
          <LookupSelect v-if="!row.originalExpenseLineId && !row.id" :model-value="row.constructionMain?.id ?? defaultConstructionMain?.id ?? null" :fetch="fetchConstructionMains!" :disabled-reason="disabledReason" placeholder="新原费用必选实际工程与施工合同" @update:model-value="selectConstructionMain(rowIndex, $event)" />
          <span v-else class="text-12px text-ink-soft">{{ row.originalExpenseLineId ? '沿原费用工程归属' : '已存归属在下方原费用分区核对' }}</span>
        </template>
        <template #counterparty="{ row, rowIndex }">
          <LookupSelect v-if="fetchCounterparties" :model-value="row.counterpartySupplierId" :fetch="fetchCounterparties" placeholder="选择实际服务分供方" @update:model-value="patch(rowIndex, { counterpartySupplierId: $event })" />
          <p v-if="row.counterpartyNameSnapshot" class="text-12px text-ink-soft">
            采用时名称：{{ row.counterpartyNameSnapshot }}
          </p>
        </template>
        <template #date="{ row, rowIndex }">
          <input
            :value="row.expenseDate"
            type="date"
            class="field-input w-full"
            @input="patch(rowIndex, { expenseDate: inputValue($event) })"
          >
        </template>
        <template #amount="{ row, rowIndex }">
          <input
            :value="kind === 'reimbursement' ? row.amount : row.allocatedAmount"
            type="number"
            min="0"
            step="0.01"
            class="field-input w-full text-right font-mono"
            :aria-label="kind === 'reimbursement' ? '费用金额' : kind === 'settlement' ? '本次关联结算金额' : kind === 'invoice' ? '本次关联发票金额' : '本次支付分摊金额'"
            :data-testid="kind === 'reimbursement' ? `reimbursement-amount-${rowIndex}` : undefined"
            @input="patch(rowIndex, kind === 'reimbursement' ? { amount: inputNumber($event) } : { allocatedAmount: inputNumber($event) })"
          >
        </template>
        <template #note="{ row, rowIndex }">
          <input :value="row.note" class="field-input w-full" @input="patch(rowIndex, { note: inputValue($event) })">
        </template>
        <template #action="{ rowIndex }">
          <button type="button" class="icon-btn" title="复制" :data-testid="`copy-grid-line-${rowIndex}`" @click="copy(rowIndex)">
            <span class="i-lucide-copy" aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn-danger" title="删除" @click="remove(rowIndex)">
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </template>
      </KitTable>
    </div>
  </section>
</template>
