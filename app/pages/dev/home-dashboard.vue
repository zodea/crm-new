<script setup lang="ts">
import type { ScheduleProjectView } from '~/lib/schedule/read-model'
import {
  summarizeHomeScheduleCoverage,
} from '~/lib/home/dashboard'

type PreviewState = 'loading' | 'schedule-empty' | 'error' | 'partial'

const route = useRoute()
const requestedState = Array.isArray(route.query.state) ? route.query.state[0] : route.query.state
const initialState = ['loading', 'schedule-empty', 'error', 'partial'].includes(String(requestedState))
  ? String(requestedState) as PreviewState
  : 'partial'
const previewState = shallowRef<PreviewState>(initialState)
const selectedProjectId = shallowRef('project-preview')
const today = '2026-07-27'

const projects = [
  {
    id: 'project-preview',
    name: '状态预览项目',
    code: 'DEMO-HOME-001',
    status: '在建',
  },
]

const partialSnapshot = {
  id: 'project-preview',
  name: '状态预览项目',
  code: 'DEMO-HOME-001',
  dependencies: [],
  plannedStart: '2026-05-01',
  plannedFinish: '2026-09-30',
  actualProgress: 0.32,
  plannedProgress: 0.48,
  deviationDays: -9,
  groups: [
    {
      id: 'group-preview-ready',
      projectId: 'project-preview',
      contractId: 'contract-preview',
      scopeBasis: 'contract',
      processLibraryId: 'schedule_process_library_decoration_v1',
      processLibraryName: '精装修标准工序',
      processLibraryVersion: 1,
      name: '已配置楼栋分组',
      sortOrder: 10,
      buildingIds: ['building-preview'],
      buildingNames: ['示例楼栋'],
      plannedStart: '2026-05-01',
      plannedFinish: '2026-09-30',
      actualProgress: 0.32,
      plannedProgress: 0.48,
      deviationDays: -9,
      tasks: [
        {
          id: 'task-preview',
          projectId: 'project-preview',
          groupId: 'group-preview-ready',
          parentId: null,
          name: '工程量联动工序',
          trade: '示例工种',
          color: '#3976c6',
          durationDays: 30,
          plannedStart: '2026-06-01',
          plannedFinish: '2026-06-30',
          baselineStart: null,
          baselineFinish: null,
          hasQty: true,
          manualProgress: null,
          stageId: 'stage-preview',
          sortOrder: 10,
          itemIds: ['item-preview'],
          itemNames: ['示例分项'],
          boqLineIds: [],
          floorPlans: [],
          applicableUnits: 0,
          completedUnits: 0,
          actualProgress: 0,
          actualStart: null,
          actualFinish: null,
          plannedProgress: 1,
          deviationDays: -30,
          sourceLibraryTaskId: 'schedule_process_library_task_waterproof',
          sourceLibraryVersion: 1,
        },
      ],
    },
    {
      id: 'group-preview-empty',
      projectId: 'project-preview',
      contractId: 'contract-preview',
      scopeBasis: 'contract',
      processLibraryId: 'schedule_process_library_decoration_v1',
      processLibraryName: '精装修标准工序',
      processLibraryVersion: 1,
      name: '待配置楼栋分组',
      sortOrder: 20,
      buildingIds: ['building-preview-2'],
      buildingNames: ['示例楼栋二'],
      tasks: [],
      plannedStart: null,
      plannedFinish: null,
      actualProgress: 0,
      plannedProgress: 0,
      deviationDays: 0,
    },
  ],
} satisfies ScheduleProjectView

const coverage = summarizeHomeScheduleCoverage(partialSnapshot)
const surfaceState = computed(() => previewState.value === 'partial'
  ? 'ready'
  : previewState.value)

function retry() {
  previewState.value = 'partial'
}
</script>

<template>
  <div data-home-dashboard data-home-dashboard-preview class="flex min-w-0 flex-col gap-3 overflow-hidden">
    <nav class="flex min-w-0 items-center justify-between gap-2.5 border-b border-line pb-2" aria-label="首页项目切换">
      <ProjectSwitcher
        v-model="selectedProjectId"
        class="w-[min(100%,320px)]"
        :projects="projects"
        aria-label="选择首页项目"
      />
      <NuxtLink to="/project" class="flex-none px-1 py-2 text-12px font-700 text-brand">
        全部项目 <span aria-hidden="true">→</span>
      </NuxtLink>
    </nav>

    <HomeDashboardSurface
      :state="surfaceState"
      :snapshot="previewState === 'partial' ? partialSnapshot : null"
      :today="today"
      selected-project-id="project-preview"
      selected-project-name="状态预览项目"
      error-description="演示数据库暂时不可用，请重新加载。"
      :coverage-title="previewState === 'partial' ? coverage.title : ''"
      :coverage-description="previewState === 'partial' ? coverage.description : ''"
      @retry="retry"
    />
  </div>
</template>
