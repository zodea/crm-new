<script setup lang="ts">
import type {
  KitEditGridColumn,
  KitEditGridValidationError,
} from '~/lib/kit/edit-grid'
import type { TargetCostItemDraft } from '~/lib/target-cost/items'
import { useTemplateRef } from 'vue'
import { COST_CATEGORIES } from '~/lib/project/cost-control'

type EditableTargetCostItem = TargetCostItemDraft & Record<string, unknown>

const props = defineProps<{
  saving: boolean
}>()

const emit = defineEmits<{
  save: []
  cancel: []
}>()

const items = defineModel<EditableTargetCostItem[]>({ required: true })
const grid = useTemplateRef<{
  focusFirstError: () => Promise<boolean>
  setErrors: (errors: readonly KitEditGridValidationError[]) => void
}>('grid')

const columns: KitEditGridColumn<EditableTargetCostItem>[] = [
  {
    key: 'category',
    label: '成本科目',
    type: 'select',
    options: COST_CATEGORIES,
    required: true,
    width: 120,
  },
  { key: 'itemName', label: '分项名称', required: true, minWidth: 210 },
  { key: 'unit', label: '单位', width: 80 },
  { key: 'qty', label: '数量', type: 'number', width: 110 },
  { key: 'unitPrice', label: '单价', type: 'number', width: 130 },
  { key: 'amount', label: '目标金额', type: 'number', required: true, width: 142 },
  { key: 'note', label: '备注', minWidth: 180 },
  { key: 'order', label: '顺序', type: 'readonly', width: 110 },
]

function moveRow(index: number, offset: number) {
  const destination = index + offset
  if (props.saving || destination < 0 || destination >= items.value.length)
    return
  const next = [...items.value]
  const [row] = next.splice(index, 1)
  if (!row)
    return
  next.splice(destination, 0, row)
  items.value = next
}

function validateNumber(
  errors: KitEditGridValidationError[],
  row: number,
  key: 'qty' | 'unitPrice' | 'amount',
  value: unknown,
  label: string,
  required = false,
) {
  if (value === '' || value == null) {
    if (required)
      errors.push({ row, key, message: `${label}为必填项` })
    return
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0)
    errors.push({ row, key, message: `${label}必须是非负数` })
}

function domainErrors(): KitEditGridValidationError[] {
  const errors: KitEditGridValidationError[] = []
  items.value.forEach((item, row) => {
    const category = String(item.category ?? '').trim()
    if (!category) {
      errors.push({ row, key: 'category', message: '成本科目为必填项' })
    }
    else if (!COST_CATEGORIES.includes(category as typeof COST_CATEGORIES[number])) {
      errors.push({ row, key: 'category', message: '成本科目不在可选范围' })
    }
    if (!String(item.itemName ?? '').trim())
      errors.push({ row, key: 'itemName', message: '分项名称为必填项' })
    validateNumber(errors, row, 'qty', item.qty, '数量')
    validateNumber(errors, row, 'unitPrice', item.unitPrice, '单价')
    validateNumber(errors, row, 'amount', item.amount, '目标金额', true)
  })
  return errors
}

async function validate() {
  const errors = domainErrors()
  grid.value?.setErrors(errors)
  if (errors.length)
    await grid.value?.focusFirstError()
  return errors
}

async function setServerErrors(fields: Record<string, string | string[]>) {
  const errors = Object.entries(fields).flatMap(([path, message]) => {
    const match = path.match(/^items\.(\d+)\.(category|itemName|qty|unitPrice|amount|unit|note)$/)
    return match ? [{ row: Number(match[1]), key: match[2]!, message: Array.isArray(message) ? message.join('；') : message }] : []
  })
  grid.value?.setErrors(errors)
  if (errors.length)
    await grid.value?.focusFirstError()
}

defineExpose({ validate, setServerErrors })
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="target-cost-item-editor-title">
    <div class="flex min-w-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <div class="mr-auto min-w-0">
        <h3 id="target-cost-item-editor-title" class="text-14px font-800 text-ink">
          编辑科目明细
        </h3>
        <p class="mt-0.5 text-11px text-ink-faint">
          目标金额用于预算对比；数量、单价和金额均保留人工确认值。
        </p>
      </div>
      <KitButton type="button" variant="ghost" :disabled="saving" @click="emit('cancel')">
        取消
      </KitButton>
      <KitButton type="button" variant="primary" :loading="saving" @click="emit('save')">
        保存科目明细
      </KitButton>
    </div>
    <div class="p-3">
      <p class="mb-2 text-11px text-ink-faint">
        勾选后可复制或删除；保存时按当前顺序重排，删除使用软删除并保留操作日志。
      </p>
      <KitEditGrid
        ref="grid"
        v-model="items"
        label="目标成本科目明细"
        :columns="columns"
        :row-ops="['add', 'copy', 'del']"
        :summary="[{ key: 'amount', agg: 'sum' }]"
        :min-rows="6"
        :readonly="saving"
      >
        <template #cell-order="{ rowIndex }">
          <div class="flex items-center gap-2 px-2">
            <button type="button" class="border-0 bg-transparent p-0 text-12px text-brand disabled:opacity-40" :disabled="saving || rowIndex === 0" :aria-label="`第 ${rowIndex + 1} 行上移`" @click="moveRow(rowIndex, -1)">
              上移
            </button>
            <button type="button" class="border-0 bg-transparent p-0 text-12px text-brand disabled:opacity-40" :disabled="saving || rowIndex === items.length - 1" :aria-label="`第 ${rowIndex + 1} 行下移`" @click="moveRow(rowIndex, 1)">
              下移
            </button>
          </div>
        </template>
      </KitEditGrid>
    </div>
  </section>
</template>
