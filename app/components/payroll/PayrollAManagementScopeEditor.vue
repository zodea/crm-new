<script setup lang="ts">
import type { PayrollAFeeCell, PayrollAFeeConfigRead, PayrollAManagementScope } from '~/lib/payroll/central-a-fees-contract'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ scope: PayrollAManagementScope, options: PayrollAFeeConfigRead['responsibilityOptions'], cellOptions?: PayrollAFeeConfigRead['cellOptions'], returnTo?: string, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollAManagementScope] }>()
function select(option: PayrollAFeeConfigRead['responsibilityOptions'][number], checked: boolean) {
  if (props.disabled || !option.eligible)
    return
  const retained = props.scope.assignments.filter(item => item.assignmentId !== option.assignmentId)
  emit('change', { assignments: checked ? [...retained, { assignmentId: option.assignmentId, scopeIds: [...option.scopeIds], cells: option.cells.map(cell => ({ ...cell })) }] : retained })
}
const cellKey = (cell: PayrollAFeeCell) => JSON.stringify([cell.unitId, cell.roomId, cell.itemId])
const selectedCells = (id: string) => props.scope.assignments.find(row => row.assignmentId === id)?.cells ?? []
const cellLabel = (cell: PayrollAFeeCell, index: number) => props.cellOptions?.find(option => cellKey(option) === cellKey(cell))?.locationLabel || `原责任第 ${index + 1} 个明确位置（名称未读取）`
function selectCell(option: PayrollAFeeConfigRead['responsibilityOptions'][number], cell: PayrollAFeeCell, checked: boolean) {
  if (props.disabled || !option.eligible)
    return
  const cells = selectedCells(option.assignmentId).filter(value => cellKey(value) !== cellKey(cell))
  if (checked)
    cells.push({ ...cell })
  const assignments = props.scope.assignments.filter(row => row.assignmentId !== option.assignmentId)
  if (cells.length)
    assignments.push({ assignmentId: option.assignmentId, scopeIds: [...option.scopeIds], cells })
  emit('change', { assignments })
}
const links = (option: PayrollAFeeConfigRead['responsibilityOptions'][number]) => option.sources.map(source => resolveNavigationTarget(source, { returnTo: props.returnTo })).filter(link => link.state === 'resolved')
</script>

<template>
  <fieldset class="grid grid-cols-1 min-w-0 gap-2 rounded border border-line p-3" :disabled="disabled">
    <legend class="px-1 text-12px font-700">
      明确的原施工责任范围
    </legend>
    <div v-for="option in options" :key="option.assignmentId" class="grid grid-cols-1 min-w-0 gap-1 text-12px leading-5">
      <label class="flex min-w-0 items-start gap-2"><input type="checkbox" class="mt-1" :checked="option.cells.length > 0 && option.cells.every(cell => selectedCells(option.assignmentId).some(value => cellKey(value) === cellKey(cell)))" :indeterminate="selectedCells(option.assignmentId).length > 0 && selectedCells(option.assignmentId).length < option.cells.length" :disabled="!option.eligible" :aria-label="option.label" @change="select(option, ($event.target as HTMLInputElement).checked)"><span class="break-words">{{ option.label }}（整份责任）</span></label>
      <p class="pl-5 text-ink-faint">
        {{ option.cells.length }} 个明确位置 · {{ option.scopeIds.length ? `${option.scopeIds.length} 条原细分责任` : '原整工种责任' }}
      </p>
      <div class="grid grid-cols-1 min-w-0 gap-2 pl-5 sm:grid-cols-2">
        <label v-for="(cell, index) in option.cells" :key="cellKey(cell)" class="flex min-w-0 items-start gap-2"><input type="checkbox" class="mt-1" :checked="selectedCells(option.assignmentId).some(value => cellKey(value) === cellKey(cell))" :disabled="!option.eligible" :aria-label="cellLabel(cell, index)" @change="selectCell(option, cell, ($event.target as HTMLInputElement).checked)"><span class="break-words">{{ cellLabel(cell, index) }}</span></label>
      </div>
      <div v-if="returnTo" class="flex flex-wrap gap-2 pl-5">
        <NuxtLink v-for="link in links(option)" :key="link.to" :to="link.to" class="text-brand underline">
          核对{{ link.label }}
        </NuxtLink>
      </div>
      <p v-for="reason in option.reasons" :key="reason" class="pl-5 text-warn">
        {{ reason }}
      </p>
    </div>
    <p v-if="!scope.assignments.length" class="text-12px text-warn">
      尚未选择管理范围；不会自动取当前班组或全项目。
    </p>
    <p v-if="scope.assignments.some(item => !options.some(option => option.assignmentId === item.assignmentId))" class="text-12px text-warn">
      原稿包含当前不可选责任，已保留；请核对来源后处理。
    </p>
  </fieldset>
</template>
