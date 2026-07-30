<script setup lang="ts">
import type { SignedDayworkFilter } from '~/lib/payroll/daywork'
import type { PayrollWorkbenchOptions } from '~/lib/payroll/statements'

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
    <label class="field">
      <span>确认状态</span>
      <select
        :value="filters.status"
        @change="patch('status', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">全部</option>
        <option value="draft">待确认</option>
        <option value="confirmed">已确认</option>
      </select>
    </label>
    <p class="ml-auto max-w-96 text-right text-11px leading-5 text-ink-faint">
      C2 只读取已确认记录；待确认记录不会进入工资草稿。
    </p>
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
