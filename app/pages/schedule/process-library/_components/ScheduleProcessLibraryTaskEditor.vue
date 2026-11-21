<script setup lang="ts">
import type { ScheduleProcessLibraryTaskDraft } from '~/lib/schedule/process-library'
import { computed, shallowRef } from 'vue'
import { Button } from '~/components/ui/button'
import ScheduleTemplatePredecessorDialog from './ScheduleTemplatePredecessorDialog.vue'

const props = defineProps<{
  tasks: readonly ScheduleProcessLibraryTaskDraft[]
  plannedWindows?: readonly {
    key: string
    plannedStart: string
    plannedFinish: string
  }[]
}>()

const emit = defineEmits<{
  'update:tasks': [tasks: ScheduleProcessLibraryTaskDraft[]]
  'add': []
  'remove': [index: number]
  'move': [payload: { index: number, direction: -1 | 1 }]
}>()

const predecessorDialogOpen = shallowRef(false)
const activeTaskIndex = shallowRef(-1)
const activeTask = computed(() => props.tasks[activeTaskIndex.value] ?? null)

function updateTask(
  index: number,
  patch: Partial<ScheduleProcessLibraryTaskDraft>,
) {
  emit('update:tasks', props.tasks.map((task, candidateIndex) =>
    candidateIndex === index ? { ...task, ...patch } : task,
  ))
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function predecessorName(predecessorKey: string): string {
  return props.tasks.find(candidate => candidate.key === predecessorKey)?.name ?? predecessorKey
}

function openPredecessorDialog(index: number) {
  activeTaskIndex.value = index
  predecessorDialogOpen.value = true
}

function savePredecessor(predecessorKey: string | null) {
  if (activeTaskIndex.value < 0)
    return
  updateTask(activeTaskIndex.value, {
    predecessorKey,
    predecessorDisabled: false,
  })
}

function restorePredecessor() {
  if (activeTaskIndex.value >= 0)
    updateTask(activeTaskIndex.value, { predecessorDisabled: false })
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="process-task-editor-title">
    <header class="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div>
        <h2 id="process-task-editor-title" class="text-14px font-800 text-ink">
          工序定义
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          表格用于精确录入；前置工序只允许选择当前工序之前的项目。
        </p>
      </div>
      <Button size="sm" @click="emit('add')">
        <span class="i-lucide-plus" aria-hidden="true" />
        新增工序
      </Button>
    </header>

    <div
      data-testid="process-library-task-scroll"
      class="min-w-0 overflow-x-auto overscroll-contain"
    >
      <div class="process-task-table min-w-1180px">
        <div class="process-task-row process-task-head" role="row">
          <span>#</span>
          <span>工序编码</span>
          <span>显示名称</span>
          <span>工种</span>
          <span>默认工期</span>
          <span>阶段映射</span>
          <span>分项编码</span>
          <span>前置工序</span>
          <span>操作</span>
        </div>
        <div
          v-for="(task, index) in tasks"
          :key="task.key"
          class="process-task-row"
          role="row"
        >
          <span class="font-mono text-11px text-ink-faint">{{ index + 1 }}</span>
          <input
            :value="task.key"
            class="field-input min-w-0 bg-surface-2 text-ink-faint"
            :aria-label="`${task.name || `第${index + 1}道工序`}编码`"
            readonly
            title="工序编码是内部稳定标识，不在版本编辑中改名"
          >
          <input
            :value="task.name"
            class="field-input min-w-0"
            :aria-label="`${task.name || `第${index + 1}道工序`}名称`"
            @input="updateTask(index, { name: inputValue($event) })"
          >
          <input
            :value="task.trade"
            class="field-input min-w-0"
            :aria-label="`${task.name}工种`"
            @input="updateTask(index, { trade: inputValue($event) })"
          >
          <input
            :value="task.durationDays"
            type="number"
            min="1"
            max="365"
            class="field-input min-w-0"
            :aria-label="`${task.name}默认工期`"
            @input="updateTask(index, { durationDays: Number(inputValue($event)) })"
          >
          <input
            :value="task.stageCode"
            class="field-input min-w-0"
            :aria-label="`${task.name}阶段映射`"
            placeholder="可选"
            @input="updateTask(index, { stageCode: inputValue($event) })"
          >
          <input
            :value="task.itemCodes.join(', ')"
            class="field-input min-w-0"
            :aria-label="`${task.name}分项编码`"
            placeholder="多个编码用逗号分隔"
            @input="updateTask(index, {
              itemCodes: inputValue($event).split(/[,，]/).map(value => value.trim()).filter(Boolean),
            })"
          >
          <button
            type="button"
            class="field-input min-w-0 truncate text-left"
            :class="task.predecessorDisabled && 'text-ink-faint line-through'"
            :aria-label="`设置${task.name}前置工序`"
            @click="openPredecessorDialog(index)"
          >
            {{ task.predecessorKey
              ? `${predecessorName(task.predecessorKey)}${task.predecessorDisabled ? '（已置灰）' : ''}`
              : '未设置' }}
          </button>
          <div class="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              :disabled="index === 0"
              :aria-label="`上移${task.name}`"
              @click="emit('move', { index, direction: -1 })"
            >
              <span class="i-lucide-arrow-up" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              :disabled="index === tasks.length - 1"
              :aria-label="`下移${task.name}`"
              @click="emit('move', { index, direction: 1 })"
            >
              <span class="i-lucide-arrow-down" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              :disabled="tasks.length <= 1"
              :aria-label="`删除${task.name}`"
              @click="emit('remove', index)"
            >
              <span class="i-lucide-trash-2 text-danger" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <ScheduleTemplatePredecessorDialog
      v-model:open="predecessorDialogOpen"
      :task="activeTask"
      :tasks="tasks"
      :planned-windows="plannedWindows"
      @save="savePredecessor"
      @restore="restorePredecessor"
    />
  </section>
</template>

<style scoped>
.process-task-row {
  display: grid;
  grid-template-columns: 42px 148px 170px 120px 94px 126px 190px 160px 112px;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--line);
}

.process-task-head {
  min-height: 38px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-size: 11px;
  font-weight: 700;
}
</style>
