<script setup lang="ts">
import { onMounted } from 'vue'

const store = useAttendanceStore()
const kit = useKitUI()

onMounted(store.load)

async function refresh() {
  await store.load()
}

async function save(input: Parameters<typeof store.save>[0]) {
  try {
    await store.save(input)
    kit.success('考勤已保存')
  }
  catch (cause) {
    kit.error(cause instanceof Error ? cause.message : String(cause))
  }
}
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-11px font-700 text-brand">
          工资核算
        </p>
        <h1 class="mt-1 text-20px font-800 text-ink">
          考勤管理
        </h1>
        <p class="mt-1 text-12px text-ink-soft">
          工人 × 日期 × 工时；计时工资依据，计件工资合理性校验
        </p>
      </div>
      <NuxtLink to="/subcontract/payroll" class="btn-secondary">
        返回工资核算
      </NuxtLink>
    </header>

    <section class="panel flex flex-wrap items-end gap-3 p-4" aria-label="考勤筛选">
      <label class="field">
        <span>项目</span>
        <select v-model="store.filters.projectId" @change="refresh">
          <option v-for="project in store.options.projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>月份</span>
        <input v-model="store.filters.month" type="month" @change="refresh">
      </label>
      <label class="field">
        <span>班组</span>
        <select v-model="store.filters.crewId" @change="refresh">
          <option value="">全部班组</option>
          <option v-for="crew in store.options.crews" :key="crew.id" :value="crew.id">
            {{ crew.name }}
          </option>
        </select>
      </label>
      <p class="ml-auto text-11px text-ink-faint">
        矩阵只在自身区域横向滚动，不改变页面宽度。
      </p>
    </section>

    <p v-if="store.error" role="alert" class="rounded-md bg-danger-soft px-3 py-2 text-12px text-danger">
      {{ store.error }}
    </p>
    <AttendanceGrid
      :project-id="store.filters.projectId"
      :crew-id="store.filters.crewId"
      :month="store.filters.month"
      :workers="store.options.workers"
      :records="store.records"
      :blocked-worker-ids="store.blockedWorkerIds"
      @save="save"
    />
  </main>
</template>

<style scoped>
.field { display: grid; min-width: 10rem; gap: .375rem; color: var(--ink-soft); font-size: .75rem; font-weight: 700; }
.field select, .field input { height: 2.25rem; border: 1px solid var(--line); border-radius: .375rem; background: white; padding: 0 .625rem; color: var(--ink); }
</style>
