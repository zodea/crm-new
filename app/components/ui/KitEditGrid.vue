<script setup lang="ts" generic="T extends KitEditGridRow">
import type {
  KitEditGridColumn,
  KitEditGridRow,
  KitEditGridRowOperation,
  KitEditGridValidationError,
} from '~/lib/kit/edit-grid'
import type { KitTableColumn } from '~/lib/kit/table'
import { computed, nextTick, shallowRef, useTemplateRef } from 'vue'
import {
  aggregateRows,
  applyDerive,
  validateRows,
} from '~/lib/kit/edit-grid'
import { toErrorMessage } from '~/lib/util/error'

type RenderedRow = T & {
  __kitRowIndex: number
  __kitRowKey: string
}

const {
  columns,
  rowOps = ['add', 'copy', 'del'],
  picker,
  summary = [],
  max,
  label = '明细',
  minRows = 3,
  readonly = false,
} = defineProps<{
  columns: KitEditGridColumn<T>[]
  rowOps?: KitEditGridRowOperation[]
  picker?: {
    label: string
    onPick: () => Promise<T[] | null>
  }
  summary?: { key: string, agg: 'sum' }[]
  max?: number
  label?: string
  minRows?: number
  readonly?: boolean
}>()

const emit = defineEmits<{
  pickerError: [error: unknown]
}>()

defineSlots<Record<string, (props: {
  row: T
  rowIndex: number
  update: (value: unknown) => void
  invalid: boolean
}) => unknown>>()

const model = defineModel<T[]>({ required: true })
const selectedRows = shallowRef<RenderedRow[]>([])
const pickerLoading = shallowRef(false)
const actionError = shallowRef('')
const validationActive = shallowRef(false)
const manualValidationErrors = shallowRef<KitEditGridValidationError[]>([])
const root = useTemplateRef<HTMLElement>('root')

const derivedRows = computed(() => applyDerive(model.value, columns))
const renderedRows = computed<RenderedRow[]>(() =>
  derivedRows.value.map((row, rowIndex) => ({
    ...row,
    __kitRowIndex: rowIndex,
    __kitRowKey: `${String(row.id ?? 'new')}:${rowIndex}`,
  })),
)

const hasSelectionOps = computed(() =>
  !readonly && (rowOps.includes('copy') || rowOps.includes('del')),
)

const tableColumns = computed<KitTableColumn[]>(() => [
  ...(hasSelectionOps.value
    ? [{
        field: '__kitSelection',
        type: 'text' as const,
        title: '选择',
        slot: '__kitSelection',
        width: 40,
        fixed: 'left' as const,
        resizable: false,
      }]
    : []),
  ...columns.map(column => ({
    field: column.key,
    title: column.required ? `${column.label} *` : column.label,
    width: column.width,
    minWidth: column.minWidth ?? 120,
    align: column.type === 'number' ? 'right' as const : 'left' as const,
    slot: cellSlotName(column),
  })),
])

const selectedIndices = computed(() =>
  [...new Set(selectedRows.value.map(row => row.__kitRowIndex))]
    .filter(index => index >= 0 && index < model.value.length)
    .sort((a, b) => a - b),
)

const validationErrors = computed(() => {
  const errors = validationActive.value ? validateRows(model.value, columns) : []
  const seen = new Set(errors.map(error => `${error.row}:${error.key}`))
  return [
    ...errors,
    ...manualValidationErrors.value.filter(error => !seen.has(`${error.row}:${error.key}`)),
  ]
})
const validationErrorKeys = computed(() =>
  new Set(validationErrors.value.map(error => `${error.row}:${error.key}`)),
)

const totals = computed(() => aggregateRows(derivedRows.value, summary))

function cellSlotName(column: KitEditGridColumn<T>) {
  return `edit-${column.key}`
}

function sourceRow(row: RenderedRow): T {
  return model.value[row.__kitRowIndex]!
}

function isInvalid(rowIndex: number, key: string) {
  return validationErrorKeys.value.has(`${rowIndex}:${key}`)
}

function errorId(rowIndex: number, key: string) {
  return `kit-edit-grid-${rowIndex}-${key}-error`
}

function errorMessage(rowIndex: number, key: string, label: string) {
  return validationErrors.value
    .find(error => error.row === rowIndex && error.key === key)
    ?.message ?? `${label}为必填项`
}

function updateRow(rowIndex: number, key: string, value: unknown) {
  const next = model.value.map((row, index) =>
    index === rowIndex ? { ...row, [key]: value } : row)
  model.value = next
  actionError.value = ''
  manualValidationErrors.value = manualValidationErrors.value
    .filter(error => error.row !== rowIndex || error.key !== key)
}

function updateNumber(rowIndex: number, key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  updateRow(rowIndex, key, raw === '' ? null : Number(raw))
}

function lookupDisabledReason(
  column: KitEditGridColumn<T>,
  row: RenderedRow,
) {
  const reason = column.lookup?.disabledReason
  return typeof reason === 'function'
    ? reason(sourceRow(row), row.__kitRowIndex)
    : reason
}

function lookupFetch(column: KitEditGridColumn<T>, row: RenderedRow) {
  return (keyword: string) =>
    column.lookup!.fetch(keyword, sourceRow(row), row.__kitRowIndex)
}

function lookupModelValue(column: KitEditGridColumn<T>, row: RenderedRow) {
  const value = sourceRow(row)[column.key]
  return typeof value === 'string' ? value : null
}

function toggleSelected(row: RenderedRow, selected: boolean) {
  selectedRows.value = selected
    ? [...selectedRows.value.filter(item => item.__kitRowKey !== row.__kitRowKey), row]
    : selectedRows.value.filter(item => item.__kitRowKey !== row.__kitRowKey)
}

function clearSelection() {
  selectedRows.value = []
}

function canAppend(count: number) {
  if (max == null || model.value.length + count <= max)
    return true
  actionError.value = `最多只能保留 ${max} 行`
  return false
}

function addRow() {
  if (!canAppend(1))
    return
  model.value = [...model.value, {} as T]
  manualValidationErrors.value = []
  clearSelection()
}

function copySelected() {
  if (!selectedIndices.value.length)
    return
  if (!canAppend(selectedIndices.value.length))
    return

  const selected = new Set(selectedIndices.value)
  const next: T[] = []
  model.value.forEach((row, index) => {
    next.push(row)
    if (!selected.has(index))
      return
    const copy = { ...row } as T
    delete copy.id
    next.push(copy)
  })
  model.value = next
  manualValidationErrors.value = []
  clearSelection()
}

function deleteSelected() {
  if (!selectedIndices.value.length)
    return
  const selected = new Set(selectedIndices.value)
  model.value = model.value.filter((_, index) => !selected.has(index))
  manualValidationErrors.value = []
  clearSelection()
}

async function pickRows() {
  if (!picker || pickerLoading.value)
    return
  pickerLoading.value = true
  actionError.value = ''
  try {
    const picked = await picker.onPick()
    if (!picked?.length || !canAppend(picked.length))
      return
    model.value = [...model.value, ...picked.map(row => ({ ...row }))]
    manualValidationErrors.value = []
    clearSelection()
  }
  catch (error) {
    actionError.value = toErrorMessage(error)
    emit('pickerError', error)
  }
  finally {
    pickerLoading.value = false
  }
}

function validate(): KitEditGridValidationError[] {
  validationActive.value = true
  return validateRows(model.value, columns)
}

function setErrors(errors: readonly KitEditGridValidationError[]) {
  validationActive.value = true
  manualValidationErrors.value = errors.map(error => ({ ...error }))
}

async function focusFirstError() {
  await nextTick()
  const first = validationErrors.value[0]
  if (!first)
    return false
  const cells = root.value?.querySelectorAll<HTMLElement>('[data-kit-grid-cell]')
  const target = cells
    ? [...cells].find(cell => cell.dataset.kitGridCell === `${first.row}:${first.key}`)
    : null
  target?.focus()
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return Boolean(target)
}

function formatSummary(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(value)
}

defineExpose({ focusFirstError, setErrors, validate })
</script>

<template>
  <section
    ref="root"
    data-ui="kit-edit-grid"
    class="min-w-0 max-w-full space-y-2"
    :aria-label="label"
  >
    <div
      v-if="!readonly && (rowOps.length || picker)"
      class="flex min-w-0 flex-wrap items-center gap-2"
    >
      <KitButton
        v-if="rowOps.includes('add')"
        type="button"
        size="sm"
        :disabled="max != null && model.length >= max"
        aria-label="添加行"
        @click="addRow"
      >
        <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
        添加
      </KitButton>
      <KitButton
        v-if="rowOps.includes('copy')"
        type="button"
        size="sm"
        :disabled="selectedIndices.length === 0"
        aria-label="复制选中"
        @click="copySelected"
      >
        <span class="i-lucide-copy h-3.5 w-3.5" aria-hidden="true" />
        复制
      </KitButton>
      <KitButton
        v-if="rowOps.includes('del')"
        type="button"
        size="sm"
        :disabled="selectedIndices.length === 0"
        aria-label="删除选中"
        @click="deleteSelected"
      >
        <span class="i-lucide-trash-2 h-3.5 w-3.5" aria-hidden="true" />
        删除
      </KitButton>
      <KitButton
        v-if="picker"
        type="button"
        size="sm"
        :loading="pickerLoading"
        :disabled="max != null && model.length >= max"
        :aria-label="picker.label"
        @click="pickRows"
      >
        <span class="i-lucide-list-plus h-3.5 w-3.5" aria-hidden="true" />
        {{ picker.label }}
      </KitButton>
      <span
        v-if="max != null"
        class="ml-auto text-12px text-ink-faint"
      >
        {{ model.length }}/{{ max }} 行
      </span>
    </div>

    <KitTable
      :columns="tableColumns"
      :data="renderedRows"
      :min-rows="minRows"
      row-key="__kitRowKey"
      :empty="{ title: '暂无明细', description: readonly ? '当前没有可查看的明细。' : '可点击“添加”或使用选择器补充明细。' }"
    >
      <template #__kitSelection="{ row }">
        <input
          type="checkbox"
          class="h-4 w-4 accent-[var(--brand)]"
          :checked="selectedIndices.includes(row.__kitRowIndex)"
          :aria-label="`选择第 ${row.__kitRowIndex + 1} 行`"
          @change="toggleSelected(row, ($event.target as HTMLInputElement).checked)"
        >
      </template>
      <template
        v-for="column in columns"
        :key="column.key"
        #[cellSlotName(column)]="{ row }"
      >
        <slot
          :name="`cell-${column.key}`"
          :row="sourceRow(row)"
          :row-index="row.__kitRowIndex"
          :update="(value: unknown) => updateRow(row.__kitRowIndex, column.key, value)"
          :invalid="isInvalid(row.__kitRowIndex, column.key)"
        >
          <span
            v-if="readonly || column.type === 'readonly' || column.derive"
            class="block min-w-0 truncate px-2 text-13px text-ink"
          >
            {{ row[column.key] ?? '—' }}
          </span>
          <LookupSelect
            v-else-if="column.type === 'lookup' && column.lookup"
            :model-value="lookupModelValue(column, row)"
            :fetch="lookupFetch(column, row)"
            :field="column.key"
            :recent-key="column.lookup.recentKey"
            :allow-create="column.lookup.allowCreate"
            :disabled-reason="lookupDisabledReason(column, row)"
            :placeholder="column.lookup.placeholder ?? `选择${column.label}`"
            :invalid="isInvalid(row.__kitRowIndex, column.key)"
            :description-id="isInvalid(row.__kitRowIndex, column.key) ? errorId(row.__kitRowIndex, column.key) : undefined"
            @update:model-value="value => updateRow(row.__kitRowIndex, column.key, value)"
          />
          <select
            v-else-if="column.type === 'select'"
            :value="sourceRow(row)[column.key] ?? ''"
            class="kit-edit-grid__control"
            :class="isInvalid(row.__kitRowIndex, column.key) ? 'kit-edit-grid__control--invalid' : undefined"
            :aria-label="`${column.label}，第 ${row.__kitRowIndex + 1} 行`"
            :aria-invalid="isInvalid(row.__kitRowIndex, column.key) || undefined"
            :aria-describedby="isInvalid(row.__kitRowIndex, column.key) ? errorId(row.__kitRowIndex, column.key) : undefined"
            :data-kit-grid-cell="`${row.__kitRowIndex}:${column.key}`"
            @change="event => updateRow(row.__kitRowIndex, column.key, (event.target as HTMLSelectElement).value)"
          >
            <option value="">
              请选择
            </option>
            <option
              v-for="option in column.options"
              :key="option"
              :value="option"
            >
              {{ option }}
            </option>
          </select>
          <input
            v-else-if="column.type === 'number'"
            type="number"
            inputmode="decimal"
            :value="sourceRow(row)[column.key] ?? ''"
            class="kit-edit-grid__control text-right tabular-nums"
            :class="isInvalid(row.__kitRowIndex, column.key) ? 'kit-edit-grid__control--invalid' : undefined"
            :aria-label="`${column.label}，第 ${row.__kitRowIndex + 1} 行`"
            :aria-invalid="isInvalid(row.__kitRowIndex, column.key) || undefined"
            :aria-describedby="isInvalid(row.__kitRowIndex, column.key) ? errorId(row.__kitRowIndex, column.key) : undefined"
            :data-kit-grid-cell="`${row.__kitRowIndex}:${column.key}`"
            @input="updateNumber(row.__kitRowIndex, column.key, $event)"
          >
          <input
            v-else
            type="text"
            :value="sourceRow(row)[column.key] ?? ''"
            class="kit-edit-grid__control"
            :class="isInvalid(row.__kitRowIndex, column.key) ? 'kit-edit-grid__control--invalid' : undefined"
            :aria-label="`${column.label}，第 ${row.__kitRowIndex + 1} 行`"
            :aria-invalid="isInvalid(row.__kitRowIndex, column.key) || undefined"
            :aria-describedby="isInvalid(row.__kitRowIndex, column.key) ? errorId(row.__kitRowIndex, column.key) : undefined"
            :data-kit-grid-cell="`${row.__kitRowIndex}:${column.key}`"
            @input="event => updateRow(row.__kitRowIndex, column.key, (event.target as HTMLInputElement).value)"
          >
          <span
            v-if="isInvalid(row.__kitRowIndex, column.key)"
            :id="errorId(row.__kitRowIndex, column.key)"
            class="block px-2 pt-0.5 text-10px leading-4 text-danger"
          >
            {{ errorMessage(row.__kitRowIndex, column.key, column.label) }}
          </span>
        </slot>
      </template>
    </KitTable>

    <footer
      v-if="summary.length"
      class="flex flex-wrap justify-end gap-x-5 gap-y-1 rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2 text-13px"
      aria-label="明细汇总"
    >
      <span
        v-for="item in summary"
        :key="item.key"
        class="font-700 text-ink"
      >
        Σ {{ columns.find(column => column.key === item.key)?.label ?? item.key }}：{{ formatSummary(totals[item.key] ?? 0) }}
      </span>
    </footer>

    <p
      v-if="validationErrors.length"
      role="alert"
      class="text-12px text-danger"
    >
      还有 {{ validationErrors.length }} 处必填明细未填写
    </p>
    <p
      v-else-if="actionError"
      role="alert"
      class="text-12px text-danger"
    >
      {{ actionError }}
    </p>
  </section>
</template>

<style scoped>
.kit-edit-grid__control {
  width: 100%;
  min-width: 0;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 0 8px;
  color: var(--ink);
  font-size: 13px;
  outline: none;
}

.kit-edit-grid__control:hover {
  border-color: var(--line);
  background: var(--panel);
}

.kit-edit-grid__control:focus {
  border-color: var(--brand);
  background: var(--panel);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.kit-edit-grid__control--invalid {
  border-color: var(--danger);
  background: var(--panel);
}
</style>
