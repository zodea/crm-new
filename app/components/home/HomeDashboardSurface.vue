<script setup lang="ts">
import type { HomeDashboardViewState } from '~/lib/home/dashboard'
import type { ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import type { DataOriginDTO } from '~/types/read-model'
import HomeScheduleOverview from '~/components/home/HomeScheduleOverview.vue'
import { Button } from '~/components/ui/button'

withDefaults(defineProps<{
  state: HomeDashboardViewState
  today: string
  snapshot?: ScheduleProjectView | null
  selectedProjectId?: string
  selectedProjectName?: string
  selectedOrigin?: DataOriginDTO
  sourceDescription?: string
  errorDescription?: string
  recoverableError?: string
  recoverableTitle?: string
  recoverableActionLabel?: string
  recoverableLoading?: boolean
  coverageTitle?: string
  coverageDescription?: string
  returnContext?: Record<string, string>
  highlightedGroupId?: string
  highlightedTaskId?: string
}>(), {
  snapshot: null,
  selectedProjectId: '',
  selectedProjectName: '',
  sourceDescription: '',
  errorDescription: '',
  recoverableError: '',
  recoverableTitle: '项目切换失败，已恢复原项目',
  recoverableActionLabel: '重试切换',
  recoverableLoading: false,
  coverageTitle: '',
  coverageDescription: '',
  highlightedGroupId: '',
  highlightedTaskId: '',
})

defineEmits<{
  retry: []
  retryRecoverable: []
  selectTask: [task: ScheduleTaskView]
}>()
</script>

<template>
  <StatePanel
    v-if="state === 'loading'"
    kind="loading"
    title="正在读取首页施工进度"
  />

  <StatePanel
    v-else-if="state === 'error' || state === 'forbidden'"
    kind="error"
    :title="state === 'forbidden' ? '当前无权查看项目施工进度' : '首页施工进度加载失败'"
    :description="errorDescription"
    action-label="重新加载"
    @action="$emit('retry')"
  />

  <StatePanel
    v-else-if="state === 'catalog-empty'"
    kind="empty"
    title="尚无可查看项目"
    description="先建立一个项目，首页才会显示对应的施工排程。"
  >
    <template #action>
      <Button class="border-solid no-underline" as-child variant="primary">
        <NuxtLink to="/project/form">
          新建项目
        </NuxtLink>
      </Button>
    </template>
  </StatePanel>

  <StatePanel
    v-else-if="state === 'not-connected'"
    kind="empty"
    :title="`${selectedProjectName || '当前项目'}的排程来源尚未接入`"
    :description="sourceDescription"
  >
    <template #action>
      <Button class="border-solid no-underline" as-child>
        <NuxtLink :to="{ path: '/schedule', query: { project: selectedProjectId, origin: selectedOrigin, from: 'home' } }">
          查看施工进度来源
        </NuxtLink>
      </Button>
    </template>
  </StatePanel>

  <StatePanel
    v-else-if="state === 'schedule-empty'"
    kind="empty"
    :title="`${selectedProjectName || '当前项目'}还没有施工排程`"
    :description="selectedOrigin ? '已读取对应项目排程，当前没有楼栋分组。此入口仅提供只读查看。' : '在施工进度页新建楼栋分组后，首页会实时显示同一份计划与实际进度。'"
  >
    <template #action>
      <div class="flex flex-wrap justify-center gap-2">
        <Button v-if="!selectedOrigin" class="border-solid no-underline" as-child variant="accent">
          <NuxtLink :to="{ path: '/schedule/new', query: { project: selectedProjectId } }">
            新建楼栋分组
          </NuxtLink>
        </Button>
        <Button class="border-solid no-underline" as-child>
          <NuxtLink :to="{ path: '/schedule', query: { project: selectedProjectId, origin: selectedOrigin, from: 'home' } }">
            打开施工进度
          </NuxtLink>
        </Button>
      </div>
    </template>
  </StatePanel>

  <div v-else-if="state === 'ready' && snapshot" class="flex min-w-0 flex-col gap-3">
    <StatePanel
      v-if="recoverableLoading"
      kind="loading"
      title="正在重新加载首页施工进度"
      compact
    />

    <StatePanel
      v-else-if="recoverableError"
      kind="error"
      :title="recoverableTitle"
      :description="recoverableError"
      :action-label="recoverableActionLabel"
      compact
      @action="$emit('retryRecoverable')"
    />

    <section
      v-if="coverageTitle"
      data-home-partial
      class="panel flex min-w-0 items-start gap-3 border-warn bg-warn-soft px-4 py-3 text-left"
      role="status"
      :aria-label="coverageTitle"
    >
      <span class="i-lucide-triangle-alert mt-0.5 h-4 w-4 flex-none text-warn" aria-hidden="true" />
      <div class="min-w-0">
        <h2 class="m-0 text-13px font-800 text-ink">
          {{ coverageTitle }}
        </h2>
        <p class="m-0 mt-1 text-12px leading-5 text-ink-soft">
          {{ coverageDescription }}
        </p>
      </div>
    </section>

    <HomeScheduleOverview
      :snapshot="snapshot"
      :today="today"
      :origin="selectedOrigin"
      :return-context="returnContext"
      :highlighted-group-id="highlightedGroupId"
      :highlighted-task-id="highlightedTaskId"
      @select-task="$emit('selectTask', $event)"
    />
  </div>
</template>
