<script setup lang="ts">
import type {
  QuantityAssignmentCurrent,
  QuantityAssignmentWorkspaceUnit,
} from '~/lib/quantity/assignment'

const props = withDefaults(defineProps<{
  units: readonly QuantityAssignmentWorkspaceUnit[]
  assignments: readonly QuantityAssignmentCurrent[]
  trade: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const selectedUnitIds = defineModel<string[]>({ required: true })

const floorGroups = computed(() => {
  const groups = new Map<string, {
    id: string
    name: string
    units: QuantityAssignmentWorkspaceUnit[]
  }>()
  for (const unit of props.units) {
    const group = groups.get(unit.floorId) ?? {
      id: unit.floorId,
      name: unit.floorName,
      units: [],
    }
    group.units.push(unit)
    groups.set(unit.floorId, group)
  }
  return [...groups.values()]
})

const currentByUnit = computed(() => new Map(
  props.assignments
    .filter(assignment => assignment.trade === props.trade)
    .map(assignment => [assignment.unitId, assignment]),
))

const selected = computed(() => new Set(selectedUnitIds.value))

function floorSelected(unitIds: readonly string[]): boolean {
  return unitIds.length > 0 && unitIds.every(unitId => selected.value.has(unitId))
}

function toggleFloor(unitIds: readonly string[], checked: boolean) {
  const next = new Set(selectedUnitIds.value)
  for (const unitId of unitIds) {
    if (checked)
      next.add(unitId)
    else
      next.delete(unitId)
  }
  selectedUnitIds.value = [...next]
}

function selectAll() {
  selectedUnitIds.value = props.units.map(unit => unit.id)
}

function clearAll() {
  selectedUnitIds.value = []
}
</script>

<template>
  <div class="grid gap-3" data-testid="quantity-assignment-unit-picker">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-12px text-ink-soft">
        已选 <b class="font-mono text-ink">{{ selectedUnitIds.length }}</b> / {{ units.length }} 户
      </span>
      <button
        type="button"
        class="ml-auto rounded-[var(--radius-sm)] px-2 py-1 text-11px text-brand font-700 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="disabled || !units.length"
        @click="selectAll"
      >
        全选当前楼栋
      </button>
      <button
        type="button"
        class="rounded-[var(--radius-sm)] px-2 py-1 text-11px text-brand font-700 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="disabled || !selectedUnitIds.length"
        @click="clearAll"
      >
        清空
      </button>
    </div>

    <fieldset :disabled="disabled" class="m-0 min-w-0 grid gap-3 border-0 p-0">
      <section
        v-for="floor in floorGroups"
        :key="floor.id"
        class="overflow-hidden border border-line rounded-[var(--radius-card)] bg-panel"
      >
        <div class="flex items-center gap-3 border-b border-line bg-surface-2 px-3 py-2">
          <label class="inline-flex cursor-pointer items-center gap-2 text-12px font-800 text-ink">
            <input
              type="checkbox"
              :checked="floorSelected(floor.units.map(unit => unit.id))"
              :aria-label="`选择${floor.name}全部户`"
              @change="toggleFloor(floor.units.map(unit => unit.id), ($event.target as HTMLInputElement).checked)"
            >
            {{ floor.name }}
          </label>
          <span class="text-11px text-ink-faint">按房号勾选</span>
        </div>

        <div class="quantity-assignment-unit-grid grid gap-px bg-line">
          <label
            v-for="unit in floor.units"
            :key="unit.id"
            class="flex min-w-0 cursor-pointer items-start gap-2 bg-panel px-3 py-2.5 hover:bg-brand-soft/25"
          >
            <input
              v-model="selectedUnitIds"
              type="checkbox"
              :value="unit.id"
              :aria-label="`选择${floor.name}${unit.name}`"
              class="mt-0.5 flex-none"
            >
            <span class="min-w-0">
              <span class="block truncate text-12px font-800 text-ink">{{ unit.name }}</span>
              <span class="mt-0.5 block truncate text-11px text-ink-soft">
                当前：{{ currentByUnit.get(unit.id)?.assigneeName ?? '未指派' }}
              </span>
              <span
                v-if="currentByUnit.get(unit.id)?.hasInvalidScopes"
                class="mt-0.5 block text-10px text-warn font-700"
              >
                个人范围异常，保存时需重新选择
              </span>
            </span>
          </label>
        </div>
      </section>
    </fieldset>

    <p v-if="!units.length" class="rounded-[var(--radius-btn)] bg-surface-2 px-3 py-4 text-center text-12px text-ink-soft">
      当前楼栋没有可配置的户。
    </p>
  </div>
</template>

<style scoped>
.quantity-assignment-unit-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}
</style>
