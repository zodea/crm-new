<script setup lang="ts">
import type {
  QuantityAssignmentScopeOption,
  QuantityAssignmentWorkspaceUnit,
} from '~/lib/quantity/assignment'
import { quantityAssignmentScopeKey } from '~/lib/quantity/assignment'

const props = withDefaults(defineProps<{
  units: readonly QuantityAssignmentWorkspaceUnit[]
  options: readonly QuantityAssignmentScopeOption[]
  trade: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const selectedScopeKeys = defineModel<string[]>({ required: true })

function optionsFor(unit: QuantityAssignmentWorkspaceUnit): QuantityAssignmentScopeOption[] {
  return props.options.filter(option => option.templateId === unit.templateId && option.trade === props.trade)
}

function optionKey(unitId: string, option: QuantityAssignmentScopeOption): string {
  return quantityAssignmentScopeKey({
    unitId,
    roomId: option.roomId,
    itemId: option.itemId,
  })
}

function unitSelected(unit: QuantityAssignmentWorkspaceUnit): boolean {
  const keys = optionsFor(unit).map(option => optionKey(unit.id, option))
  return keys.length > 0 && keys.every(key => selectedScopeKeys.value.includes(key))
}

function toggleUnit(unit: QuantityAssignmentWorkspaceUnit, checked: boolean) {
  const next = new Set(selectedScopeKeys.value)
  for (const option of optionsFor(unit)) {
    const key = optionKey(unit.id, option)
    if (checked)
      next.add(key)
    else
      next.delete(key)
  }
  selectedScopeKeys.value = [...next]
}
</script>

<template>
  <div class="grid gap-3" data-testid="quantity-assignment-scope-picker">
    <p class="text-12px leading-relaxed text-ink-soft">
      每一户按自己的户型模板列出稳定房间与分项；不同户型不会共用房间 ID。
    </p>

    <fieldset :disabled="disabled" class="grid gap-3">
      <details
        v-for="unit in units"
        :key="unit.id"
        open
        class="overflow-hidden border border-line rounded-[var(--radius-card)] bg-panel"
      >
        <summary class="cursor-pointer list-none bg-surface-2 px-3 py-2 text-12px font-800 text-ink">
          {{ unit.floorName }} · {{ unit.name }}
        </summary>
        <div v-if="optionsFor(unit).length" class="grid gap-px bg-line sm:grid-cols-2">
          <label class="col-span-full flex cursor-pointer items-center gap-2 bg-brand-soft/30 px-3 py-2 text-11px font-700 text-brand-deep">
            <input
              type="checkbox"
              :checked="unitSelected(unit)"
              :aria-label="`选择${unit.name}全部房间分项`"
              @change="toggleUnit(unit, ($event.target as HTMLInputElement).checked)"
            >
            选择该户全部 {{ trade }} 范围
          </label>
          <label
            v-for="option in optionsFor(unit)"
            :key="optionKey(unit.id, option)"
            class="flex min-w-0 cursor-pointer items-start gap-2 bg-panel px-3 py-2.5 hover:bg-brand-soft/25"
          >
            <input
              v-model="selectedScopeKeys"
              type="checkbox"
              :value="optionKey(unit.id, option)"
              :aria-label="`选择${unit.name}${option.roomName}${option.itemName}`"
              class="mt-0.5 flex-none"
            >
            <span class="min-w-0 text-12px text-ink">
              <b class="font-700">{{ option.roomName }}</b>
              <span class="text-ink-faint"> · </span>
              {{ option.itemName }}
            </span>
          </label>
        </div>
        <p v-else class="px-3 py-3 text-12px text-ink-soft">
          该户型暂无 {{ trade }} 的有效模板明细，不能细化范围。
        </p>
      </details>
    </fieldset>
  </div>
</template>
