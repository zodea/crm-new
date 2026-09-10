<script setup lang="ts">
import type { HomeProjectScheduleRead } from '~/lib/home/project-source'
import type { ScheduleTaskView } from '~/lib/schedule/read-model'
import { computed, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { Button } from '~/components/ui/button'
import { summarizeHomeScheduleCoverage } from '~/lib/home/dashboard'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { buildQuantityDrillLocation } from '~/lib/schedule/navigation'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useHomeDashboardStore } from '~/stores/home-dashboard'

const route = useRoute()
const router = useRouter()
const store = useHomeDashboardStore()
const visibility = useDataVisibilityStore()
const { warning } = useKitUI()
const today = toLocalDateInputValue()
const result = shallowRef<HomeProjectScheduleRead | null>(null)
const loading = shallowRef(false)
const error = shallowRef('')
const forbidden = shallowRef(false)
let latestRequest = 0
let wasDeactivated = false
const projectId = computed(() => String(route.query.project ?? ''))
const origin = computed(() => route.query.origin === 'real' || route.query.origin === 'demo' ? route.query.origin : undefined)
const returnLocation = computed(() => ({ path: '/', query: { project: projectId.value || undefined, origin: origin.value, group: route.query.group, task: route.query.task } }))
const coverage = computed(() => result.value?.snapshot ? summarizeHomeScheduleCoverage(result.value.snapshot) : null)

async function read() {
  const request = ++latestRequest
  result.value = null
  error.value = ''
  forbidden.value = false
  if (!projectId.value || !origin.value) {
    error.value = '项目或来源参数无效，请从首页重新选择项目。'
    loading.value = false
    return
  }
  loading.value = true
  try {
    const next = await store.readProject({ id: projectId.value, origin: origin.value, includeDemo: visibility.includeDemo }, today)
    if (request === latestRequest)
      result.value = next
  }
  catch (cause) {
    if (request === latestRequest) {
      const { problem } = projectProblemFromUnknown(cause)
      error.value = problem.message
      forbidden.value = problem.code === 'forbidden'
    }
  }
  finally {
    if (request === latestRequest)
      loading.value = false
  }
}

function selectTask(task: ScheduleTaskView) {
  const group = result.value?.snapshot?.groups.find(row => row.id === task.groupId)
  if (!group)
    return
  if (!task.hasQty) {
    warning(`「${task.name}」为手动填报工序，当前入口仅提供只读查看`)
    return
  }
  void router.push(buildQuantityDrillLocation('schedule', group, task, origin.value))
}

watch([projectId, origin, () => visibility.includeDemo], () => {
  if (!wasDeactivated && route.path === '/schedule')
    void read()
}, { immediate: true })
onDeactivated(() => {
  wasDeactivated = true
  latestRequest++
})
onBeforeUnmount(() => {
  latestRequest++
})
onActivated(() => {
  if (wasDeactivated) {
    wasDeactivated = false
    void read()
  }
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3" data-home-schedule-source>
    <header class="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="m-0 text-18px font-800 text-ink">
          {{ result?.project.name || '项目施工进度' }}
        </h1>
        <p class="mb-0 mt-1 text-12px text-ink-soft">
          {{ origin === 'demo' ? '测试数据 · ' : '' }}施工进度只读查看
        </p>
      </div>
      <Button class="border-solid no-underline" as-child>
        <NuxtLink :to="returnLocation">
          返回首页项目
        </NuxtLink>
      </Button>
    </header>
    <StatePanel v-if="loading" kind="loading" title="正在读取项目施工进度" />
    <StatePanel
      v-else-if="error"
      kind="error"
      :title="forbidden ? '当前无权查看项目施工进度' : '项目施工进度读取失败'"
      :description="error"
      action-label="重新加载"
      @action="read"
    />
    <StatePanel
      v-else-if="result?.availability === 'not-connected'"
      kind="empty"
      title="排程来源尚未接入"
      :description="result.reason"
    />
    <StatePanel
      v-else-if="result?.availability === 'empty'"
      kind="empty"
      title="当前项目还没有施工排程"
      description="已读取对应项目排程，当前没有楼栋分组。"
    />
    <template v-else-if="result?.snapshot">
      <StatePanel v-if="coverage?.isPartial" kind="empty" :title="coverage.title" :description="coverage.description" compact />
      <HomeScheduleOverview
        :snapshot="result.snapshot"
        :today="today"
        :origin="origin"
        hide-schedule-link
        :highlighted-group-id="String(route.query.group ?? '')"
        :highlighted-task-id="String(route.query.task ?? '')"
        @select-task="selectTask"
      />
    </template>
  </div>
</template>
