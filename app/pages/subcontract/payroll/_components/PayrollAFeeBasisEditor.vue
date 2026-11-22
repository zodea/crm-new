<script setup lang="ts">
import type { PayrollAFeeBasis, PayrollAFeeCell, PayrollAFeeConfigRead } from '~/lib/payroll/central-a-fees-contract'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ basis: PayrollAFeeBasis, read: PayrollAFeeConfigRead, returnTo?: string, disabled: boolean }>()
const emit = defineEmits<{ change: [value: PayrollAFeeBasis] }>()
function label(item: PayrollAFeeConfigRead['items'][number]) {
  const classification = item.housingClassification.state === 'value' ? { 'wall-tile': '墙砖', 'floor-tile': '地砖', 'other': '其他分项' }[item.housingClassification.value] : '待确认分类'
  return `${item.itemName || '名称未记录'} · ${item.unit || '单位未记录'} · ${classification}`
}
function item(id: string, selected: boolean) {
  const itemIds = selected ? [...new Set([...props.basis.itemIds, id])] : props.basis.itemIds.filter(value => value !== id)
  const scope = props.basis.scope.kind === 'cells' ? { kind: 'cells' as const, cells: props.basis.scope.cells.filter(cell => itemIds.includes(cell.itemId)) } : props.basis.scope
  emit('change', { ...props.basis, itemIds, scope })
}
const cellKey = (cell: PayrollAFeeCell) => JSON.stringify([cell.unitId, cell.roomId, cell.itemId])
const cells = computed(() => props.read.cellOptions.filter(cell => props.basis.itemIds.includes(cell.itemId)).map(({ locationLabel, ...cell }) => ({ cell, label: locationLabel })))
function toggleCell(cell: PayrollAFeeCell, selected: boolean) {
  const current = props.basis.scope.kind === 'cells' ? props.basis.scope.cells : []
  emit('change', { ...props.basis, scope: { kind: 'cells', cells: selected ? [...current, cell] : current.filter(value => cellKey(value) !== cellKey(cell)) } })
}
function source(cell: PayrollAFeeCell) {
  const intent = props.read.context.capabilities.includes('quantity:read')
    ? props.read.responsibilityOptions.filter(option => option.cells.some(known => cellKey(known) === cellKey(cell))).flatMap(option => option.sources).find(intent => intent.kind === 'entity-detail' && intent.subject.state === 'resolved' && intent.subject.entity === 'quantity-unit' && intent.subject.id === cell.unitId && intent.filters.projectId === props.read.scope.projectId && intent.filters.dataOrigin === props.read.context.origin)
    : null
  if (!intent || intent.kind !== 'entity-detail')
    return resolveNavigationTarget({ kind: 'unavailable', reason: 'forbidden' })
  return resolveNavigationTarget({ ...intent, filters: { ...intent.filters, roomId: cell.roomId, itemId: cell.itemId } }, { returnTo: props.returnTo })
}
</script>

<template>
  <fieldset class="grid grid-cols-1 min-w-0 gap-3 border border-line rounded p-3" :disabled="disabled">
    <legend class="px-1 text-12px font-700">
      适用分项与真实完成基数
    </legend>
    <div class="grid grid-cols-1 min-w-0 gap-2 sm:grid-cols-2">
      <label v-for="option in read.items" :key="option.itemId" class="flex min-w-0 items-start gap-2 text-12px leading-5"><input type="checkbox" class="mt-1" :checked="basis.itemIds.includes(option.itemId)" :aria-label="label(option)" @change="item(option.itemId, ($event.target as HTMLInputElement).checked)"><span class="break-words">{{ label(option) }}</span></label>
    </div>
    <p v-if="!basis.itemIds.length" class="text-12px text-warn">
      尚未选择分项；空范围不会按全项目核算。
    </p>
    <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">完成量范围<select class="field-input min-w-0 w-full" :value="basis.scope.kind" aria-label="费用完成量范围" @change="emit('change', { ...basis, scope: ($event.target as HTMLSelectElement).value === 'project' ? { kind: 'project' } : { kind: 'cells', cells: [] } })"><option value="cells">逐个选择已证户内位置</option><option value="project">当前主体内所选分项的已证完成</option></select></label>
    <div v-if="basis.scope.kind === 'cells'" class="grid grid-cols-1 min-w-0 gap-2">
      <div v-for="entry in cells" :key="cellKey(entry.cell)" class="flex flex-wrap items-start justify-between gap-2 text-12px leading-5">
        <label class="flex min-w-0 items-start gap-2"><input type="checkbox" class="mt-1" :checked="basis.scope.cells.some(cell => cellKey(cell) === cellKey(entry.cell))" @change="toggleCell(entry.cell, ($event.target as HTMLInputElement).checked)"><span class="break-words">{{ entry.label }}</span></label><template v-if="returnTo">
          <NuxtLink v-for="link in [source(entry.cell)].filter(link => link.state === 'resolved')" :key="link.to" :to="link.to" class="text-brand underline">
            核对户内工程量
          </NuxtLink>
        </template>
      </div>
      <p v-if="!cells.length" class="text-12px text-ink-faint">
        当前分项尚无可选的明确户内位置。
      </p>
    </div>
  </fieldset>
</template>
