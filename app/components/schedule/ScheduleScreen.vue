<script setup lang="ts">
import { computed } from 'vue'
import ProjectSwitcher from '~/components/project/ProjectSwitcher.vue'
import ScheduleBoard from '~/components/schedule/ScheduleBoard.vue'
import ScheduleDependencyDialog from '~/components/schedule/ScheduleDependencyDialog.vue'
import ScheduleHistoryPanel from '~/components/schedule/ScheduleHistoryPanel.vue'
import ScheduleTaskDialog from '~/components/schedule/ScheduleTaskDialog.vue'
import { Button } from '~/components/ui/button'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import { useScheduleWorkspace } from '~/composables/useScheduleWorkspace'
import { buildBoqBuildingEvidenceLocation } from '~/lib/schedule/binding-navigation'

const props = withDefaults(defineProps<{ projectId?: string }>(), { projectId: '' })
const route = useRoute()
const bindingSource = computed(() => {
  const projectId = typeof route.query.project === 'string' ? route.query.project : ''
  const groupId = typeof route.query.group === 'string' ? route.query.group : ''
  const contractId = typeof route.query.bindingContract === 'string' ? route.query.bindingContract : ''
  const lineId = typeof route.query.bindingLine === 'string' ? route.query.bindingLine : ''
  return projectId && groupId && contractId && route.query.origin === 'real' ? buildBoqBuildingEvidenceLocation(projectId, groupId, contractId, route.query, lineId, true) : null
})
const { store, today, origin, canWrite, sourceError, selectedProjectId, initialized, taskDraftKey, selectedTask, taskDialogOpen, dependencyDialogOpen, highlightedGroupId, selectedGroupName, selectedDependency, selectedGroupTasks, predecessorTasks, selectedDisabledDependencies, projectOptions, initialize, openTask, openDependencyEditor, closeDependencyEditor, setBaseline, saveTask, removeTask, saveDependency, removeDependency, restoreDependency, rescheduleTask, addTask, drillQuantity, recheck, recoverPending } = useScheduleWorkspace(props)
</script>

<template>
  <div class="schedule-screen flex min-w-0 flex-col gap-4">
    <section class="panel p-4">
      <NuxtLink v-if="bindingSource" :to="bindingSource" class="mb-3 inline-flex text-12px text-brand underline">
        返回合同清单来源
      </NuxtLink>
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-52 flex-1">
          <div class="text-11px font-700 tracking-wide text-brand">
            施工进度
          </div>
          <div class="mt-0.5 flex items-center gap-1.5">
            <h1 class="text-20px font-850 text-ink">
              WBS 排程与实际进度
            </h1>
            <ContextHelp label="施工排程" text="在同一行查看计划日期与实际完成进度。前置工序完成后，后续工序按设定的间隔开始。" />
          </div>
        </div>
        <div class="min-w-52">
          <span class="field-label block">项目</span>
          <ProjectSwitcher
            v-model="selectedProjectId"
            :projects="projectOptions"
            :loading="!initialized && store.loading"
            :error="store.error"
            aria-label="选择施工进度项目"
          />
        </div>
        <div class="flex flex-wrap gap-2 self-end">
          <Button as-child>
            <NuxtLink to="/schedule/process-library">
              <span class="i-lucide-library" aria-hidden="true" />
              标准工序库
            </NuxtLink>
          </Button>
          <button type="button" class="btn-secondary" :disabled="!canWrite || !store.snapshot?.groups.length" @click="setBaseline">
            <span class="i-lucide-git-commit-horizontal mr-1" /> 设置基准
          </button>
          <NuxtLink v-if="canWrite" :to="{ path: '/schedule/new', query: { project: selectedProjectId, origin } }" class="btn-accent">
            <span class="i-lucide-plus mr-1" /> 新建楼栋分组
          </NuxtLink>
        </div>
      </div>

      <div v-if="store.snapshot" class="mt-4 grid grid-cols-4 gap-2 text-11px">
        <div class="summary-cell">
          <span>计划周期</span><strong>{{ store.snapshot.plannedStart ?? '—' }} — {{ store.snapshot.plannedFinish ?? '—' }}</strong>
        </div>
        <div class="summary-cell">
          <span>楼栋分组</span><strong>{{ store.snapshot.groups.length }} 组</strong>
        </div>
        <div class="summary-cell">
          <span>计划进度</span><strong>{{ Math.round(store.snapshot.plannedProgress * 100) }}%</strong>
        </div>
        <div class="summary-cell">
          <span>实际进度</span><strong>{{ Math.round(store.snapshot.actualProgress * 100) }}%</strong>
        </div>
      </div>
    </section>

    <p v-if="store.contractSourceState === 'unavailable'" class="panel p-3 text-12px text-ink-soft" role="status">
      {{ store.contractSourceMessage }}
    </p>

    <section v-if="(!initialized || store.loading) && !store.snapshot" class="panel grid min-h-64 gap-3 p-4" role="status" aria-label="正在读取施工排程">
      <span class="sr-only">正在读取施工排程…</span>
      <div class="h-7 w-56 animate-pulse rounded bg-surface-3" />
      <div class="grid grid-cols-4 gap-2">
        <div v-for="index in 4" :key="index" class="h-14 animate-pulse rounded-lg bg-surface-2" />
      </div>
      <div class="h-36 animate-pulse rounded-lg bg-surface-2" />
    </section>
    <section v-else-if="sourceError || store.error" class="panel grid min-h-64 place-items-center p-5 text-center text-12px text-danger" role="alert">
      {{ sourceError || store.error }}
      <button type="button" class="btn-secondary" @click="initialize">
        重新读取
      </button>
    </section>
    <section v-else-if="!store.catalog.length" class="panel grid min-h-64 place-items-center p-5 text-center">
      <div>
        <span class="i-lucide-building-2 text-24px text-ink-faint" /><p class="mt-2 text-13px font-700">
          尚无可排程项目
        </p>
      </div>
    </section>
    <section v-else-if="store.snapshot && !store.snapshot.groups.length" class="panel flex min-h-64 flex-col items-center justify-center gap-2 p-5 text-center">
      <span class="i-lucide-calendar-plus text-24px text-brand" />
      <p class="text-14px font-800 text-ink">
        当前项目还没有楼栋排程分组
      </p>
      <p class="text-12px text-ink-soft">
        选择当前工序库版本建立计划，再按现场情况调整。
      </p>
      <NuxtLink v-if="canWrite" :to="{ path: '/schedule/new', query: { project: selectedProjectId, origin } }" class="btn-accent mt-1">
        新建楼栋分组
      </NuxtLink>
    </section>
    <ScheduleBoard
      v-else-if="store.snapshot"
      :snapshot="store.snapshot"
      :today="today"
      :highlighted-group-id="highlightedGroupId"
      :readonly="!canWrite"
      :origin="origin ?? undefined"
      :return-context="route.query"
      :contract-binding-available="store.contractSourceState !== 'unavailable'"
      @select-task="openTask"
      @add-task="addTask"
      @reschedule-task="rescheduleTask"
    />

    <section v-if="store.pendingCommand" class="panel grid gap-2 p-4" role="alert">
      <p>上次提交结果尚未确认，当前输入已保留。核对原提交后才能继续修改。</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="store.saving" @click="recoverPending">
          核对原提交
        </button><button type="button" class="btn-secondary" :disabled="store.saving" @click="recheck">
          重新核对权限与资料
        </button>
      </div>
    </section>
    <ScheduleHistoryPanel v-if="store.history && !sourceError" :history="store.history" />
    <ScheduleTaskDialog
      v-model:open="taskDialogOpen"
      :task="selectedTask"
      :read-error="store.error"
      :draft-key="taskDraftKey"
      :group-name="selectedGroupName"
      :dependency="selectedDependency"
      :predecessor-tasks="predecessorTasks"
      :busy="store.saving"
      :pending="Boolean(store.pendingCommand)"
      :readonly="!canWrite"
      @recover="recoverPending"
      @recheck="recheck"
      @save="saveTask"
      @remove="removeTask"
      @drill="drillQuantity"
      @edit-dependency="openDependencyEditor"
    />

    <ScheduleDependencyDialog
      v-model:open="dependencyDialogOpen"
      :task="selectedTask"
      :read-error="store.error"
      :group-name="selectedGroupName"
      :group-tasks="selectedGroupTasks"
      :dependencies="store.snapshot?.dependencies ?? []"
      :dependency="selectedDependency"
      :disabled-dependencies="selectedDisabledDependencies"
      :busy="store.saving"
      :pending="Boolean(store.pendingCommand)"
      :readonly="!canWrite"
      @recover="recoverPending"
      @recheck="recheck"
      @save="saveDependency"
      @remove="removeDependency"
      @restore="restoreDependency"
      @request-close="closeDependencyEditor"
    />
  </div>
</template>

<style scoped>
.schedule-screen { container-type: inline-size; overflow: hidden; }
.summary-cell { display: flex; min-width: 0; flex-direction: column; gap: 2px; border-radius: 8px; background: var(--surface-2); padding: 8px 10px; color: var(--ink-faint); }
.summary-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 12px; }
.summary-cell strong { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
@container (max-width: 48rem) { .schedule-screen .grid-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 26rem) { .schedule-screen .grid-cols-4 { grid-template-columns: minmax(0, 1fr); } }
</style>
