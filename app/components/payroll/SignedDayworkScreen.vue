<script setup lang="ts">
import type { SignedDayworkRecord } from '~/lib/payroll/daywork'
import { onMounted } from 'vue'
import ContextHelp from '~/components/ui/ContextHelp.vue'

const store = useSignedDayworkStore()
const kit = useKitUI()
const editingRecord = shallowRef<SignedDayworkRecord | null>(null)

onMounted(store.load)

async function reload(filters: typeof store.filters) {
  Object.assign(store.filters, filters)
  await store.load()
}

async function save(input: Parameters<typeof store.save>[0]) {
  try {
    await store.save(input)
    editingRecord.value = null
    kit.success(input.status === 'confirmed' ? '已保存并确认签工' : '签工草稿已保存')
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
        <div class="mt-1 flex items-center gap-1.5">
          <h1 class="text-20px font-800 text-ink">
            零星签工
          </h1>
          <ContextHelp label="零星签工" text="按日登记用工，经证明人确认后纳入月度工资核算。" />
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <NuxtLink to="/subcontract/attendance" class="btn-secondary">
          打开考勤
        </NuxtLink>
        <NuxtLink to="/subcontract/payroll" class="btn-primary">
          返回工资核算
        </NuxtLink>
      </div>
    </header>

    <SignedDayworkToolbar
      :filters="store.filters"
      :options="store.options"
      @change="reload"
    />
    <p v-if="store.error" role="alert" class="rounded-md bg-danger-soft px-3 py-2 text-12px text-danger">
      {{ store.error }}
    </p>
    <SignedDayworkEntryForm
      :project-id="store.filters.projectId"
      :crew-id="store.filters.crewId"
      :month="store.filters.month"
      :workers="store.options.workers"
      :record="editingRecord"
      @save="save"
      @cancel="editingRecord = null"
    />
    <SignedDayworkTable
      :records="store.records"
      :loading="store.loading"
      :has-snapshot="store.hasSnapshot"
      @edit="editingRecord = $event"
    />
  </main>
</template>
