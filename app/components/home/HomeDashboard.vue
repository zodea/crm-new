<script setup lang="ts">
import type { HomeDashboardViewState } from '~/lib/home/dashboard'
import type { ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import {
  resolveHomeProjectSwitch,
  summarizeHomeScheduleCoverage,
} from '~/lib/home/dashboard'
import { buildQuantityDrillLocation } from '~/lib/schedule/navigation'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'

const route = useRoute()
const router = useRouter()
const store = useScheduleStore()
const { error: toastError, warning } = useKitUI()

const today = toLocalDateInputValue()
const selectedProjectId = shallowRef('')
const confirmedProjectId = shallowRef('')
const lastReadySnapshot = shallowRef<ScheduleProjectView | null>(null)
const initialized = shallowRef(false)
const initializationError = shallowRef('')
const recoverableSwitchError = shallowRef('')
const failedProjectId = shallowRef('')
const recoverableIntent = shallowRef<'switch' | 'refresh'>('switch')
const retryingRecoverable = shallowRef(false)
let latestSelectionRequest = 0
let wasDeactivated = false

const selectedSnapshot = computed(() => lastReadySnapshot.value?.id === selectedProjectId.value
  ? lastReadySnapshot.value
  : null)

const selectedProject = computed(() => store.catalog.find(project => project.id === selectedProjectId.value) ?? null)
const projectOptions = computed(() => store.catalog.map(project => ({
  id: project.id,
  name: project.name,
  code: project.code,
  status: project.status,
})))
const projectSelection = computed({
  get: () => selectedProjectId.value,
  set: projectId => void selectProject(projectId),
})
const coverage = computed(() => selectedSnapshot.value
  ? summarizeHomeScheduleCoverage(selectedSnapshot.value)
  : { isPartial: false, title: '', description: '' })
const recoverableTitle = computed(() => recoverableIntent.value === 'refresh'
  ? '首页刷新失败，已保留当前项目'
  : '项目切换失败，已恢复原项目')
const recoverableActionLabel = computed(() => recoverableIntent.value === 'refresh'
  ? '重新刷新'
  : '重试切换')
const viewState = computed<HomeDashboardViewState>(() => {
  if (!initialized.value)
    return 'loading'
  if (initializationError.value)
    return 'error'
  if (!store.catalog.length)
    return 'catalog-empty'
  if (store.loading && !selectedSnapshot.value)
    return 'loading'
  if (!selectedSnapshot.value)
    return store.error ? 'error' : 'loading'
  if (!selectedSnapshot.value.groups.length)
    return 'schedule-empty'
  return 'ready'
})

function routeProjectId(): string {
  const value = Array.isArray(route.query.project) ? route.query.project[0] : route.query.project
  return value == null ? '' : String(value)
}

async function replaceRouteProject(projectId: string) {
  await router.replace({
    query: {
      ...route.query,
      project: projectId || undefined,
      group: undefined,
      task: undefined,
    },
  })
}

async function selectProject(
  projectId: string,
  options: {
    syncRoute?: boolean
    force?: boolean
    intent?: 'switch' | 'refresh'
  } = {},
) {
  if (!projectId)
    return
  const { syncRoute = true, force = false, intent = 'switch' } = options
  if (
    !force
    && projectId === confirmedProjectId.value
    && lastReadySnapshot.value?.id === projectId
  ) {
    selectedProjectId.value = projectId
    if (syncRoute && routeProjectId() !== projectId)
      await replaceRouteProject(projectId)
    return
  }

  const request = ++latestSelectionRequest
  const previousProjectId = confirmedProjectId.value
  recoverableSwitchError.value = ''
  failedProjectId.value = ''

  const result = await resolveHomeProjectSwitch({
    requestedId: projectId,
    confirmedId: previousProjectId,
    load: async (requestedId) => {
      await store.loadProject(requestedId, today)
      if (!store.snapshot || store.snapshot.id !== requestedId)
        throw new Error('目标项目不存在或已被删除')
      return store.snapshot
    },
  })
  if (request !== latestSelectionRequest)
    return

  if (result.ok) {
    selectedProjectId.value = result.selectedId
    confirmedProjectId.value = result.selectedId
    lastReadySnapshot.value = result.value
    if (syncRoute && routeProjectId() !== result.selectedId)
      await replaceRouteProject(result.selectedId)
    return
  }

  selectedProjectId.value = result.selectedId
  failedProjectId.value = result.failedId
  recoverableIntent.value = intent
  const message = toErrorMessage(result.error)
  if (result.selectedId && lastReadySnapshot.value?.id === result.selectedId) {
    recoverableSwitchError.value = message
    toastError(recoverableTitle.value, message)
  }
  if (routeProjectId() !== result.selectedId)
    await replaceRouteProject(result.selectedId)
}

async function initialize() {
  initialized.value = false
  initializationError.value = ''
  try {
    await store.loadCatalog()
    const requested = store.catalog.find(project => project.id === routeProjectId())
    const preferred = requested
      ?? store.catalog.find(project => project.groupCount > 0)
      ?? store.catalog[0]
    initialized.value = true
    if (preferred)
      await selectProject(preferred.id)
  }
  catch (cause) {
    initializationError.value = `首页项目加载失败：${toErrorMessage(cause)}`
    initialized.value = true
  }
}

watch(
  () => route.query.project,
  () => {
    if (!initialized.value)
      return
    const requestedId = routeProjectId()
    const requested = store.catalog.find(project => project.id === requestedId)
    if (requested && requested.id !== selectedProjectId.value)
      void selectProject(requested.id, { syncRoute: false })
    else if (requestedId && confirmedProjectId.value && requestedId !== confirmedProjectId.value)
      void replaceRouteProject(confirmedProjectId.value)
  },
)

function retry() {
  if (initializationError.value) {
    void initialize()
    return
  }
  const projectId = failedProjectId.value || selectedProjectId.value
  if (projectId)
    void selectProject(projectId, { force: true })
}

async function retryRecoverable() {
  if (retryingRecoverable.value)
    return

  retryingRecoverable.value = true
  recoverableSwitchError.value = ''
  try {
    if (recoverableIntent.value === 'refresh')
      await refreshActivatedProject()
    else if (failedProjectId.value)
      await selectProject(failedProjectId.value, { force: true })
  }
  finally {
    retryingRecoverable.value = false
  }
}

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
onActivated(() => {
  if (!wasDeactivated || !selectedProjectId.value)
    return
  wasDeactivated = false
  void refreshActivatedProject()
})

async function refreshActivatedProject() {
  recoverableSwitchError.value = ''
  initializationError.value = ''
  try {
    await store.loadCatalog()
  }
  catch (cause) {
    const message = toErrorMessage(cause)
    if (lastReadySnapshot.value) {
      recoverableIntent.value = 'refresh'
      failedProjectId.value = selectedProjectId.value
      recoverableSwitchError.value = message
      toastError(recoverableTitle.value, message)
    }
    else {
      initializationError.value = `首页项目加载失败：${message}`
    }
    return
  }

  if (!store.catalog.length) {
    selectedProjectId.value = ''
    confirmedProjectId.value = ''
    lastReadySnapshot.value = null
    await replaceRouteProject('')
    return
  }

  const current = store.catalog.find(project => project.id === selectedProjectId.value)
  if (!current) {
    const fallback = store.catalog.find(project => project.groupCount > 0) ?? store.catalog[0]
    if (!fallback)
      return
    selectedProjectId.value = ''
    confirmedProjectId.value = ''
    lastReadySnapshot.value = null
    await selectProject(fallback.id, { force: true, intent: 'refresh' })
    return
  }

  await selectProject(current.id, {
    syncRoute: false,
    force: true,
    intent: 'refresh',
  })
}
</script>

<template>
  <div data-home-dashboard class="home-dashboard flex min-w-0 flex-col gap-3">
    <nav class="project-switcher" aria-label="首页项目切换">
      <ProjectSwitcher
        v-model="projectSelection"
        class="w-[min(100%,320px)]"
        :projects="projectOptions"
        :loading="!initialized || store.loading"
        :error="initializationError"
        :disabled="initialized && !projectOptions.length"
        aria-label="选择首页项目"
      />
      <NuxtLink to="/project" class="all-projects-link">
        全部项目 <span aria-hidden="true">→</span>
      </NuxtLink>
    </nav>

    <HomeDashboardSurface
      :state="viewState"
      :snapshot="selectedSnapshot"
      :today="today"
      :selected-project-id="selectedProjectId"
      :selected-project-name="selectedProject?.name"
      :error-description="initializationError || store.error"
      :recoverable-error="recoverableSwitchError"
      :recoverable-title="recoverableTitle"
      :recoverable-action-label="recoverableActionLabel"
      :recoverable-loading="retryingRecoverable"
      :coverage-title="coverage.title"
      :coverage-description="coverage.description"
      :highlighted-group-id="String(route.query.group ?? '')"
      :highlighted-task-id="String(route.query.task ?? '')"
      @select-task="selectTask"
      @retry="retry"
      @retry-recoverable="retryRecoverable"
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
