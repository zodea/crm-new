<script setup lang="ts">
import type {
  PayrollWorkbenchOptions,
  WageStatementFilter,
} from '~/lib/payroll/statements'
import { computed } from 'vue'
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
      <label class="field">
        <span>状态</span>
        <select
          :value="filters.status"
          @change="patchFilter('status', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="checked">已核对</option>
          <option value="released">已发放</option>
        </select>
      </label>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <NuxtLink :to="draftLocation" class="btn-primary">
          新建工资草稿
        </NuxtLink>
        <NuxtLink :to="{ path: '/subcontract/attendance', query: relatedQuery }" class="btn-secondary">
          打开考勤
        </NuxtLink>
        <NuxtLink :to="{ path: '/subcontract/daywork', query: relatedQuery }" class="btn-secondary">
          录入 C2 签工
        </NuxtLink>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-11px text-ink-faint">
      <p>
        A、C1、C2 在同一工资工作台建单、核对与发放；已发放单据仅展示冻结快照。
      </p>
      <p>
        B · 合同清单直报：等待合同工资清单关系接入
      </p>
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
