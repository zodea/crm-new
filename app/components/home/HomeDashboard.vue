<script setup lang="ts">
import type { ScheduleTaskView } from '~/lib/schedule/read-model'
import { buildQuantityDrillLocation } from '~/lib/schedule/navigation'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

const route = useRoute()
const router = useRouter()
const store = useScheduleStore()
const { warning } = useKitUI()

const today = toLocalDateInputValue()
const selectedProjectId = shallowRef('')
const initialized = shallowRef(false)
const initializationError = shallowRef('')
let wasDeactivated = false

const selectedSnapshot = computed(() => store.snapshot?.id === selectedProjectId.value
  ? store.snapshot
  : null)

const selectedProject = computed(() => store.catalog.find(project => project.id === selectedProjectId.value) ?? null)
const projectOptions = computed(() => store.catalog.map(project => ({
  id: project.id,
  name: project.name,
  code: project.code,
  status: project.status,
})))

function routeProjectId(): string {
  const value = Array.isArray(route.query.project) ? route.query.project[0] : route.query.project
  return value == null ? '' : String(value)
}

async function initialize() {
  try {
    await store.loadCatalog()
    const requested = store.catalog.find(project => project.id === routeProjectId())
    const preferred = requested
      ?? store.catalog.find(project => project.groupCount > 0)
      ?? store.catalog[0]
    initialized.value = true
    selectedProjectId.value = preferred?.id ?? ''
  }
  catch (cause) {
    initializationError.value = `首页项目加载失败：${toErrorMessage(cause)}`
    initialized.value = true
  }
}

watch(selectedProjectId, async (projectId) => {
  if (!initialized.value || !projectId)
    return

  const routeMatches = routeProjectId() === projectId
  if (!routeMatches) {
    await router.replace({
      query: {
        ...route.query,
        project: projectId,
        group: undefined,
        task: undefined,
      },
    })
  }

  try {
    await store.loadProject(projectId, today)
  }
  catch {
    // store.error 已保留可展示的领域错误。
  }
})

watch(
  () => route.query.project,
  () => {
    if (!initialized.value)
      return
    const requested = store.catalog.find(project => project.id === routeProjectId())
    if (requested && requested.id !== selectedProjectId.value)
      selectedProjectId.value = requested.id
  },
)

function selectTask(task: ScheduleTaskView) {
  const group = selectedSnapshot.value?.groups.find(candidate => candidate.id === task.groupId)
  if (!group)
    return
  if (!task.hasQty) {
    warning(`「${task.name}」为手动填报工序，请在施工进度页更新进度`)
    return
  }
  router.push(buildQuantityDrillLocation('home', group, task))
}

onMounted(initialize)
onDeactivated(() => {
  wasDeactivated = true
})
onActivated(async () => {
  if (!wasDeactivated || !selectedProjectId.value)
    return
  wasDeactivated = false
  await Promise.allSettled([
    store.loadCatalog(),
    store.loadProject(selectedProjectId.value, today),
  ])
})
</script>

<template>
  <div class="home-dashboard flex min-w-0 flex-col gap-3">
    <nav class="project-switcher" aria-label="首页项目切换">
      <ProjectSwitcher
        v-model="selectedProjectId"
        class="w-[min(100%,320px)]"
        :projects="projectOptions"
        :loading="!initialized"
        :error="initializationError"
        aria-label="选择首页项目"
      />
      <NuxtLink to="/project" class="all-projects-link">
        全部项目 <span aria-hidden="true">→</span>
      </NuxtLink>
    </nav>

    <section v-if="!initialized" class="panel grid min-h-64 gap-3 p-4" role="status" aria-label="正在读取首页施工进度">
      <span class="sr-only">正在读取首页施工进度…</span>
      <div class="h-7 w-56 animate-pulse rounded bg-surface-3" />
      <div class="h-8 animate-pulse rounded bg-surface-2" />
      <div class="h-52 animate-pulse rounded bg-surface-2" />
    </section>
    <section v-else-if="initializationError || store.error" class="panel grid min-h-64 place-items-center p-5 text-center text-12px text-danger" role="alert">
      {{ initializationError || store.error }}
    </section>
    <section v-else-if="!store.catalog.length" class="panel grid min-h-64 place-items-center p-5 text-center">
      <div>
        <span class="i-lucide-building-2 text-24px text-ink-faint" />
        <p class="mt-2 text-13px font-700 text-ink">
          尚无可查看项目
        </p>
      </div>
    </section>
    <section v-else-if="store.loading && !selectedSnapshot" class="panel grid min-h-64 gap-3 p-4" role="status">
      <div class="h-7 w-56 animate-pulse rounded bg-surface-3" />
      <div class="h-8 animate-pulse rounded bg-surface-2" />
      <div class="h-52 animate-pulse rounded bg-surface-2" />
    </section>
    <section v-else-if="selectedSnapshot && !selectedSnapshot.groups.length" class="panel flex min-h-64 flex-col items-center justify-center gap-2 p-5 text-center">
      <span class="i-lucide-calendar-plus text-26px text-brand" />
      <p class="text-14px font-800 text-ink">
        {{ selectedProject?.name }}还没有施工排程
      </p>
      <p class="text-12px text-ink-soft">
        在施工进度页新建楼栋分组后，首页会实时显示同一份计划与实际进度。
      </p>
      <div class="mt-1 flex flex-wrap justify-center gap-2">
        <NuxtLink :to="{ path: '/schedule/new', query: { project: selectedProjectId } }" class="btn-accent">
          新建楼栋分组
        </NuxtLink>
        <NuxtLink :to="{ path: '/schedule', query: { project: selectedProjectId } }" class="btn-secondary">
          打开施工进度
        </NuxtLink>
      </div>
    </section>
    <HomeScheduleOverview
      v-else-if="selectedSnapshot"
      :snapshot="selectedSnapshot"
      :today="today"
      :highlighted-group-id="String(route.query.group ?? '')"
      :highlighted-task-id="String(route.query.task ?? '')"
      @select-task="selectTask"
    />
  </div>
</template>

<style scoped>
.home-dashboard { container-type: inline-size; overflow: hidden; }
.project-switcher { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
.all-projects-link { flex: none; padding: 8px 4px; color: var(--brand); font-size: 12px; font-weight: 700; white-space: nowrap; }
.all-projects-link:hover { color: var(--brand-deep); }

@container (max-width: 30rem) {
  .project-switcher { align-items: stretch; }
  .project-switcher :deep(.project-switcher-root) { flex: 1; }
}
</style>
