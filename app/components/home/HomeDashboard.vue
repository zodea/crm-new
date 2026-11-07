<script setup lang="ts">
import type { HomeDashboardViewState } from '~/lib/home/dashboard'
import type { HomeProjectReference, HomeProjectScheduleRead } from '~/lib/home/project-source'
import type { ScheduleTaskView } from '~/lib/schedule/read-model'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { summarizeHomeScheduleCoverage } from '~/lib/home/dashboard'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { buildQuantityDrillLocation, scheduleFilterQuery, scheduleReturnContextQuery } from '~/lib/schedule/navigation'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useHomeDashboardStore } from '~/stores/home-dashboard'

const route = useRoute()
const router = useRouter()
const store = useHomeDashboardStore()
const visibility = useDataVisibilityStore()
const { error: toastError, warning } = useKitUI()
const today = toLocalDateInputValue()
const current = shallowRef<HomeProjectScheduleRead | null>(null)
const initialized = shallowRef(false)
const pending = shallowRef(false)
const error = shallowRef('')
const forbidden = shallowRef(false)
const failedProject = shallowRef<HomeProjectReference | null>(null)
let latestRequest = 0
let wasDeactivated = false
let leavingTarget: object | null = null
let deferredRouteProject: HomeProjectReference | null = null

const includeDemo = computed(() => visibility.includeDemo)
const projectOptions = computed(() => store.catalog.map(project => ({
  id: project.key,
  name: project.name,
  code: project.code,
  status: `${project.status}${project.origin === 'demo' ? ' · 测试数据' : ''}`,
})))
const projectSelection = computed({
  get: () => current.value?.project.key ?? '',
  set: (key: string) => {
    const project = store.catalog.find(row => row.key === key)
    if (project)
      void selectProject(project)
  },
})
const snapshot = computed(() => current.value?.snapshot ?? null)
const coverage = computed(() => snapshot.value
  ? summarizeHomeScheduleCoverage(snapshot.value)
  : { title: '', description: '' })
const viewState = computed<HomeDashboardViewState>(() => {
  if (!initialized.value || (pending.value && !current.value))
    return 'loading'
  if (error.value && !current.value)
    return forbidden.value ? 'forbidden' : 'error'
  if (!store.catalog.length)
    return 'catalog-empty'
  if (current.value?.availability === 'not-connected')
    return 'not-connected'
  if (current.value?.availability === 'empty')
    return 'schedule-empty'
  return snapshot.value ? 'ready' : 'loading'
})

function queryText(value: unknown): string {
  return String((Array.isArray(value) ? value[0] : value) ?? '')
}

function routeProject() {
  const id = queryText(route.query.project)
  const origin = queryText(route.query.origin)
  const matches = store.catalog.filter(row => row.id === id && (!origin || row.origin === origin))
  return matches.length === 1 ? matches[0] : undefined
}

async function syncRoute(project: HomeProjectReference) {
  if (wasDeactivated || route.path !== '/' || router.currentRoute.value.path !== '/')
    return
  if (leavingTarget) {
    deferredRouteProject = project
    return
  }
  const origin = project.origin
  if (queryText(route.query.project) === project.id && queryText(route.query.origin) === origin)
    return
  await router.replace({ query: { ...route.query, project: project.id, origin: origin || undefined, group: undefined, task: undefined } })
}

function finishLeaving(to: object, failed: boolean) {
  if (leavingTarget !== to)
    return
  leavingTarget = null
  const project = deferredRouteProject
  deferredRouteProject = null
  if (failed && project && current.value?.project.key === project.key && !wasDeactivated && route.path === '/' && router.currentRoute.value.path === '/')
    void syncRoute(project)
}

// 项目读取可能在离开首页的异步路由尚未解析时完成；此时同步 query 会取消用户导航。
onBeforeRouteLeave((to) => {
  leavingTarget = to
})
const removeAfterEach = router.afterEach((to, _from, failure) => finishLeaving(to, Boolean(failure)))
const removeRouteError = router.onError((_error, to) => finishLeaving(to, true))

async function selectProject(project: HomeProjectReference) {
  const request = ++latestRequest
  pending.value = true
  error.value = ''
  forbidden.value = false
  failedProject.value = null
  try {
    const result = await store.readProject({ id: project.id, origin: project.origin, includeDemo: includeDemo.value }, today)
    if (request !== latestRequest)
      return
    current.value = result
    await syncRoute(result.project)
  }
  catch (cause) {
    if (request !== latestRequest)
      return
    const { problem } = projectProblemFromUnknown(cause)
    error.value = problem.message
    forbidden.value = problem.code === 'forbidden'
    failedProject.value = project
    if (current.value?.project.key === project.key && ['forbidden', 'not-found', 'relationship-mismatch'].includes(problem.code))
      current.value = null
    if (current.value) {
      await syncRoute(current.value.project)
      toastError('项目读取失败，已保留当前项目', problem.message)
    }
  }
  finally {
    if (request === latestRequest)
      pending.value = false
  }
}

async function initialize() {
  const request = ++latestRequest
  pending.value = true
  error.value = ''
  forbidden.value = false
  failedProject.value = null
  try {
    await store.loadCatalog(includeDemo.value)
    if (request !== latestRequest)
      return
    initialized.value = true
    if (!store.catalog.length) {
      current.value = null
      if (queryText(route.query.project))
        error.value = '指定项目不存在或当前不可查看，请从全部项目重新选择。'
      return
    }
    const requested = queryText(route.query.project)
    const preferred = routeProject() ?? (!requested && !queryText(route.query.origin) ? store.catalog[0] : undefined)
    if (!preferred) {
      current.value = null
      error.value = '指定项目不存在、来源不匹配或当前不可查看，请重新选择项目。'
      return
    }
    await selectProject(preferred)
  }
  catch (cause) {
    if (request !== latestRequest)
      return
    const { problem } = projectProblemFromUnknown(cause)
    error.value = problem.message
    forbidden.value = problem.code === 'forbidden'
    if (forbidden.value)
      current.value = null
  }
  finally {
    initialized.value = true
    if (request === latestRequest)
      pending.value = false
  }
}

function retry() {
  if (failedProject.value)
    void selectProject(failedProject.value)
  else
    void initialize()
}

function selectTask(task: ScheduleTaskView) {
  const group = snapshot.value?.groups.find(candidate => candidate.id === task.groupId)
  if (!group)
    return
  if (!task.hasQty) {
    warning(`「${task.name}」为手动填报工序，首页仅提供只读查看`)
    return
  }
  void router.push(buildQuantityDrillLocation('home', group, task, current.value?.project.origin, scheduleFilterQuery(route.query)))
}

watch(() => [route.query.project, route.query.origin], () => {
  if (!wasDeactivated && route.path === '/' && initialized.value && routeProject()?.key !== current.value?.project.key)
    void initialize()
})
watch(includeDemo, () => {
  current.value = null
  if (!wasDeactivated && route.path === '/')
    void initialize()
})
onMounted(initialize)
onDeactivated(() => {
  wasDeactivated = true
  leavingTarget = null
  deferredRouteProject = null
  latestRequest++
  pending.value = false
})
onBeforeUnmount(() => {
  latestRequest++
  removeAfterEach()
  removeRouteError()
})
onActivated(() => {
  if (wasDeactivated) {
    wasDeactivated = false
    void initialize()
  }
})
</script>

<template>
  <div data-home-dashboard class="home-dashboard flex min-w-0 flex-col gap-3">
    <nav class="project-switcher" aria-label="首页项目切换">
      <ProjectSwitcher
        v-model="projectSelection"
        class="w-[min(100%,320px)]"
        :projects="projectOptions"
        :loading="!initialized || store.loading || pending"
        :error="error"
        :disabled="initialized && !projectOptions.length"
        aria-label="选择首页项目"
      />
      <NuxtLink to="/project" class="all-projects-link">
        全部项目 <span aria-hidden="true">→</span>
      </NuxtLink>
    </nav>
    <StatePanel
      v-if="current && error"
      kind="error"
      title="项目读取失败，已保留当前项目"
      :description="error"
      action-label="重新加载"
      compact
      @action="retry"
    />
    <HomeDashboardSurface
      :state="viewState"
      :snapshot="snapshot"
      :today="today"
      :selected-project-id="current?.project.id"
      :selected-project-name="current?.project.name"
      :selected-origin="(current?.project.origin)"
      :source-description="current?.reason"
      :error-description="error"
      :coverage-title="coverage.title"
      :coverage-description="coverage.description"
      :return-context="scheduleReturnContextQuery(route.query)"
      :highlighted-group-id="queryText(route.query.group)"
      :highlighted-task-id="queryText(route.query.task)"
      @select-task="selectTask"
      @retry="retry"
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
