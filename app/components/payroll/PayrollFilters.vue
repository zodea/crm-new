<script setup lang="ts">
import type {
  PayrollWorkbenchOptions,
  WageStatementFilter,
  WageStatementStatus,
} from '~/lib/payroll/statements'
import { computed } from 'vue'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import {
  payrollDraftLocation,
  payrollFilterQuery,
} from '~/lib/payroll/navigation'

const props = defineProps<{
  options: PayrollWorkbenchOptions
  filters: WageStatementFilter
}>()

const emit = defineEmits<{
  'update:filters': [filters: WageStatementFilter]
}>()

const draftLocation = computed(() => payrollDraftLocation(props.filters))
const relatedQuery = computed(() => payrollFilterQuery(props.filters))

function patchFilter(key: keyof WageStatementFilter, value: string) {
  emit('update:filters', { ...props.filters, [key]: value })
}

const statuses = computed(() => Array.isArray(props.filters.status) ? props.filters.status : props.filters.status ? [props.filters.status] : [])
function setStatuses(values: string[]) {
  emit('update:filters', { ...props.filters, status: values.filter((value): value is WageStatementStatus => ['draft', 'checked', 'released'].includes(value)) })
}
</script>

<template>
  <section class="panel p-4" aria-label="工资筛选与入口">
    <div class="flex flex-wrap items-end gap-3">
      <label class="field">
        <span>项目</span>
        <select
          :value="filters.projectId"
          @change="patchFilter('projectId', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部项目</option>
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
          @input="patchFilter('month', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="field">
        <span>班组</span>
        <select
          :value="filters.crewId"
          @change="patchFilter('crewId', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部班组</option>
          <option v-for="crew in options.crews" :key="crew.id" :value="crew.id">
            {{ crew.name }}
          </option>
        </select>
      </label>
      <KitMultiSelectFilter :model-value="statuses" label="状态" :options="[{ key: 'draft', label: '草稿' }, { key: 'checked', label: '已核对' }, { key: 'released', label: '已发放' }]" @update:model-value="setStatuses" />

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <NuxtLink :to="draftLocation" class="btn-primary">
          新建工资草稿
        </NuxtLink>
        <ContextHelp label="工资核算" text="计件、考勤和零星签工工资均可在此建单、核对与发放。已发放工资保留发放时的记录，不再随来源变动。B 类工资已退役，历史记录只读。" />
        <NuxtLink :to="{ path: '/subcontract/attendance', query: relatedQuery }" class="btn-secondary">
          打开考勤
        </NuxtLink>
        <NuxtLink :to="{ path: '/subcontract/daywork', query: relatedQuery }" class="btn-secondary">
          录入零星签工
        </NuxtLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.field {
  display: grid;
  min-width: 9rem;
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
  font-size: .8125rem;
}
</style>
