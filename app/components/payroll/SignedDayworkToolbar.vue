<script setup lang="ts">
import type { SignedDayworkFilter, SignedDayworkStatus } from '~/lib/payroll/daywork'
import type { PayrollWorkbenchOptions } from '~/lib/payroll/statements'
import { computed } from 'vue'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'

const props = defineProps<{
  filters: SignedDayworkFilter
  options: PayrollWorkbenchOptions
}>()

const emit = defineEmits<{
  change: [filters: SignedDayworkFilter]
}>()

function patch(key: keyof SignedDayworkFilter, value: string) {
  emit('change', { ...props.filters, [key]: value })
}
const statuses = computed(() => Array.isArray(props.filters.status) ? props.filters.status : props.filters.status ? [props.filters.status] : [])
function setStatuses(values: string[]) {
  emit('change', { ...props.filters, status: values.filter((value): value is SignedDayworkStatus => ['draft', 'confirmed'].includes(value)) })
}
</script>

<template>
  <section class="panel flex flex-wrap items-end gap-3 p-4" aria-label="签工筛选">
    <label class="field">
      <span>项目</span>
      <select
        :value="filters.projectId"
        @change="patch('projectId', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="project in options.projects" :key="project.id" :value="project.id">
          {{ project.name }}<template v-if="project.code"> · {{ project.code }}</template>
        </option>
      </select>
    </label>
    <label class="field">
      <span>月份</span>
      <input
        type="month"
        :value="filters.month"
        @change="patch('month', ($event.target as HTMLInputElement).value)"
      >
    </label>
    <label class="field">
      <span>班组</span>
      <select
        :value="filters.crewId"
        @change="patch('crewId', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">全部班组</option>
        <option v-for="crew in options.crews" :key="crew.id" :value="crew.id">
          {{ crew.name }}
        </option>
      </select>
    </label>
    <KitMultiSelectFilter :model-value="statuses" label="确认状态" :options="[{ key: 'draft', label: '待确认' }, { key: 'confirmed', label: '已确认' }]" @update:model-value="setStatuses" />
    <ContextHelp label="签工计入工资" text="仅已确认签工可计入工资草稿。" />
  </section>
</template>

<style scoped>
.field {
  display: grid;
  min-width: 10rem;
  gap: .375rem;
  color: var(--ink-soft);
  font-size: .75rem;
  font-weight: 700;
}
.field select,
.field input {
  height: 2.25rem;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: .375rem;
  background: white;
  padding: 0 .625rem;
  color: var(--ink);
}
</style>
