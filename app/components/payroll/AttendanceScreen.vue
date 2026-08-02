<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import {
  payrollFilterQuery,
  payrollFiltersFromQuery,
  payrollListLocation,
} from '~/lib/payroll/navigation'

const store = useAttendanceStore()
const kit = useKitUI()
const route = useRoute()
const saveError = shallowRef('')
const returnStatus = shallowRef(
  payrollFiltersFromQuery(route.query).status ?? '',
)

const visibleWorkers = computed(() =>
  store.options.workers.filter(worker =>
    !store.filters.crewId || worker.crewId === store.filters.crewId,
  ),
)
const visibleWorkerIds = computed(() =>
  new Set(visibleWorkers.value.map(worker => worker.id)),
)
const visibleBlockedWorkerCount = computed(() =>
  store.blockedWorkerIds.filter(workerId => visibleWorkerIds.value.has(workerId)).length,
)
const selectedProject = computed(() =>
  store.options.projects.find(project => project.id === store.filters.projectId),
)
const relatedQuery = computed(() => payrollFilterQuery({
  projectId: store.filters.projectId,
  month: store.filters.month,
  crewId: store.filters.crewId,
  status: returnStatus.value,
}))
const payrollReturnTo = computed(() => payrollListLocation({
  projectId: store.filters.projectId,
  month: store.filters.month,
  crewId: store.filters.crewId,
  status: returnStatus.value,
}))

async function refresh(clearFacts = false) {
  saveError.value = ''
  await store.load({ clearFacts })
}

async function changeScope() {
  await refresh(true)
}

async function save(input: Parameters<typeof store.save>[0]) {
  saveError.value = ''
  try {
    const saved = await store.save(input)
    if (saved)
      kit.success('考勤已保存')
  }
  catch (cause) {
    saveError.value = cause instanceof Error ? cause.message : String(cause)
    kit.error(saveError.value)
  }
}

onMounted(() => {
  const incoming = payrollFiltersFromQuery(route.query, {
    projectId: store.filters.projectId,
    month: store.filters.month,
    crewId: store.filters.crewId,
    status: '',
  })
  Object.assign(store.filters, {
    projectId: incoming.projectId ?? '',
    month: incoming.month || store.filters.month,
    crewId: incoming.crewId ?? '',
  })
  returnStatus.value = incoming.status ?? ''
  void refresh(true)
})
</script>

<template>
  <main data-ui="attendance-screen" class="grid min-w-0 gap-3">
    <header class="panel flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
      <div class="min-w-0">
        <p class="m-0 text-11px font-700 text-brand">
          工资核算 · C1 真实来源
        </p>
        <h1 class="m-0 mt-0.5 truncate text-18px font-800 text-ink">
          考勤管理
        </h1>
        <p class="m-0 mt-0.5 text-11px text-ink-faint">
          工人 × 日期 × 工时；记录直接写入 attendance_records
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <NuxtLink :to="{ path: '/subcontract/daywork', query: relatedQuery }" class="btn-secondary">
          <span class="i-lucide-calendar-check mr-1" aria-hidden="true" />
          C2 零星签工
        </NuxtLink>
        <NuxtLink :to="payrollReturnTo" class="btn-primary">
          <span class="i-lucide-wallet-cards mr-1" aria-hidden="true" />
          工资核算
        </NuxtLink>
      </div>
    </header>

    <section
      data-ui="attendance-toolbar"
      class="panel flex min-w-0 flex-wrap items-end gap-3 p-3.5"
      aria-label="考勤筛选"
    >
      <label class="attendance-filter">
        <span>项目</span>
        <select
          v-model="store.filters.projectId"
          :disabled="store.loading || store.saving"
          @change="changeScope"
        >
          <option v-if="!store.options.projects.length" value="">
            暂无项目
          </option>
          <option v-for="project in store.options.projects" :key="project.id" :value="project.id">
            {{ project.name }}<template v-if="project.code"> · {{ project.code }}</template>
          </option>
        </select>
      </label>
      <label class="attendance-filter">
        <span>月份</span>
        <input
          v-model="store.filters.month"
          type="month"
          :disabled="store.loading || store.saving"
          @change="changeScope"
        >
      </label>
      <label class="attendance-filter">
        <span>班组</span>
        <select
          v-model="store.filters.crewId"
          :disabled="store.loading || store.saving"
          @change="changeScope"
        >
          <option value="">
            全部班组
          </option>
          <option v-for="crew in store.options.crews" :key="crew.id" :value="crew.id">
            {{ crew.name }}
          </option>
        </select>
      </label>
      <span
        v-if="visibleBlockedWorkerCount"
        class="chip chip-warn"
        role="status"
      >
        {{ visibleBlockedWorkerCount }} 人本月不可编辑
      </span>
      <KitButton
        class="ml-auto"
        variant="secondary"
        :loading="store.loading"
        :disabled="store.saving"
        @click="refresh()"
      >
        <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />
        刷新
      </KitButton>
    </section>

    <StatePanel
      v-if="store.loading && !store.options.projects.length"
      kind="loading"
      title="正在载入考勤事实"
      description="正在读取项目、名册、当月考勤与工资锁定状态。"
      compact
    />
    <StatePanel
      v-else-if="store.error"
      kind="error"
      title="考勤载入失败"
      :description="store.error"
      action-label="重新载入"
      compact
      @action="refresh()"
    />
    <StatePanel
      v-else-if="!store.options.projects.length"
      kind="empty"
      title="暂无可用项目"
      description="考勤必须归属真实项目；请先维护项目后再录入。"
      compact
    >
      <template #action>
        <NuxtLink to="/project" class="btn-primary">
          前往项目列表
        </NuxtLink>
      </template>
    </StatePanel>
    <template v-else>
      <AttendanceSummary
        :worker-count="visibleWorkers.length"
        :records="store.records"
        :blocked-worker-count="visibleBlockedWorkerCount"
      />

      <section
        data-ui="attendance-boundary"
        class="grid min-w-0 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line md:grid-cols-2"
        aria-label="考勤能力边界"
      >
        <div class="min-w-0 bg-panel px-3.5 py-3">
          <p class="m-0 flex items-center gap-1.5 text-12px font-800 text-ok-ink">
            <span class="i-lucide-database h-3.5 w-3.5" aria-hidden="true" />
            当前真实可用
          </p>
          <p class="m-0 mt-1 text-11px leading-5 text-ink-soft">
            逐格新增或覆盖正常工时、加班工时和施工内容；当前范围为
            {{ selectedProject?.name || '所选项目' }} · {{ store.filters.month }}。
          </p>
        </div>
        <div class="min-w-0 bg-surface-2 px-3.5 py-3">
          <p class="m-0 flex items-center gap-1.5 text-12px font-800 text-warn-ink">
            <span class="i-lucide-construction h-3.5 w-3.5" aria-hidden="true" />
            边界与后续能力
          </p>
          <p class="m-0 mt-1 text-11px leading-5 text-ink-soft">
            C2 人员改走零星签工；批量导入、批量填充及工资已发放后的调整单尚未开放，不在本页伪装入口。
          </p>
        </div>
      </section>

      <StatePanel
        v-if="!visibleWorkers.length"
        kind="empty"
        title="当前范围没有可录考勤的工人"
        description="请检查工人的当前项目、班组档案或工程量责任范围；本页不会临时创建名册关系。"
        compact
      >
        <template #action>
          <NuxtLink to="/base/worker" class="btn-primary">
            查看工人名册
          </NuxtLink>
        </template>
      </StatePanel>
      <AttendanceGrid
        v-else
        :project-id="store.filters.projectId"
        :crew-id="store.filters.crewId"
        :month="store.filters.month"
        :workers="visibleWorkers"
        :records="store.records"
        :blocked-worker-ids="store.blockedWorkerIds"
        :loading="store.loading"
        :saving="store.saving"
        :save-error="saveError"
        @clear-error="saveError = ''"
        @save="save"
      />
    </template>
  </main>
</template>

<style scoped>
.attendance-filter {
  display: grid;
  min-width: min(10rem, 100%);
  gap: .375rem;
  color: var(--ink-soft);
  font-size: .75rem;
  font-weight: 700;
}

.attendance-filter select,
.attendance-filter input {
  width: 100%;
  height: 2.25rem;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--panel);
  padding: 0 .625rem;
  color: var(--ink);
}

.attendance-filter select:focus-visible,
.attendance-filter input:focus-visible {
  border-color: var(--brand);
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-ring);
}

@media (max-width: 480px) {
  .attendance-filter {
    width: 100%;
  }
}
</style>
