<script setup lang="ts">
import type { PhaseCardStatus } from '~/lib/project/phases'
import type { PhaseTask } from '~/stores/phase-task'
import { computed, onMounted, shallowRef, watch } from 'vue'
import { createDefaultPhaseTasks, derivePhaseViews } from '~/lib/project/phases'

const props = defineProps<{
  projectId: string
}>()

const store = usePhaseTaskStore()
const { undoToast, error } = useKitUI()
const showEditor = shallowRef(false)
const openPhase = shallowRef<number | null>(null)

const tasks = computed(() => {
  const persisted = store.byProject(props.projectId)
  return persisted.length ? persisted : createDefaultPhaseTasks(props.projectId)
})
const phaseViews = computed(() => derivePhaseViews(tasks.value))
const activePhaseView = computed(() =>
  openPhase.value == null ? undefined : phaseViews.value[openPhase.value],
)

const STATUS_VIEW: Record<PhaseCardStatus, { icon: string, node: string, text: string }> = {
  done: {
    icon: 'i-lucide-circle-check',
    node: 'border-ok bg-panel',
    text: 'text-ok-ink',
  },
  active: {
    icon: 'i-lucide-arrow-right-circle',
    node: 'border-brand bg-brand',
    text: 'text-white',
  },
  pending: {
    icon: 'i-lucide-clock-3',
    node: 'border-line-strong bg-panel',
    text: 'text-ink-faint',
  },
}

watch(phaseViews, (views) => {
  if (openPhase.value != null)
    return
  const active = views.find(view => view.status === 'active')
  openPhase.value = active?.index ?? 0
}, { immediate: true })

function togglePhase(index: number) {
  openPhase.value = openPhase.value === index ? null : index
}

async function saveTasks(next: PhaseTask[]) {
  try {
    const logIds = await store.saveProject(props.projectId, next)
    showEditor.value = false
    undoToast('阶段任务已更新', () => store.undoSave(logIds))
  }
  catch {
    error('阶段任务保存失败，请重试')
  }
}

onMounted(() => store.load())
</script>

<template>
  <section class="mb-3 min-w-0" aria-labelledby="project-phase-title">
    <header class="mb-2 flex min-h-7 flex-wrap items-center gap-2 border-b border-line pb-1">
      <h3 id="project-phase-title" class="m-0 text-13px font-700 text-ink">
        阶段时间线 · 任务文件
      </h3>
      <span class="text-11px text-ink-faint">点击阶段查看任务</span>
      <button type="button" class="btn-secondary ml-auto text-12px" @click="showEditor = true">
        <span class="i-lucide-square-pen mr-1 text-12px" aria-hidden="true" />编辑阶段
      </button>
    </header>

    <div class="min-w-0 overflow-x-auto pb-1">
      <ol class="project-phase-flow m-0 grid min-w-[720px] list-none grid-cols-6 p-0" aria-label="项目六阶段流程">
        <li
          v-for="view in phaseViews"
          :key="view.name"
          class="relative z-1 flex min-w-0 flex-col items-center px-1"
        >
          <button
            type="button"
            class="project-phase-node flex max-w-full items-center gap-1.5 rounded-full border-2 px-3 py-1.5"
            :class="[STATUS_VIEW[view.status].node, STATUS_VIEW[view.status].text]"
            :aria-current="view.status === 'active' ? 'step' : undefined"
            :aria-expanded="openPhase === view.index"
            :aria-controls="`project-phase-tasks-${view.index}`"
            :aria-label="`查看${view.name}任务，已完成 ${view.done}/${view.total}`"
            @click="togglePhase(view.index)"
          >
            <span :class="STATUS_VIEW[view.status].icon" class="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            <span class="truncate text-12px font-700">{{ view.name }}</span>
          </button>
          <span class="mt-1 font-mono text-10px text-ink-faint">
            {{ view.done }}/{{ view.total }}
          </span>
        </li>
      </ol>
    </div>

    <div
      v-if="activePhaseView"
      :id="`project-phase-tasks-${activePhaseView.index}`"
      role="region"
      :aria-label="`${activePhaseView.name}阶段任务`"
      class="mt-2 border-t border-line pt-2"
    >
      <div class="mb-2 flex items-center gap-2">
        <h4 class="m-0 text-13px font-700 text-ink">
          {{ activePhaseView.name }} · 阶段任务
        </h4>
        <span v-if="activePhaseView.total" class="ml-auto text-11px font-mono text-ink-faint">
          已完成 {{ activePhaseView.done }}/{{ activePhaseView.total }}
        </span>
      </div>

      <div v-if="activePhaseView.tasks.length" class="space-y-1.5">
        <div
          v-for="(task, index) in activePhaseView.tasks"
          :key="task.id"
          class="flex flex-wrap items-center gap-2.5 rounded-[var(--radius-sm)] border border-line px-2.5 py-1.5"
          :class="task.status === 'pending' ? 'bg-surface-2' : 'bg-ok-soft'"
        >
          <span
            class="grid h-6 w-6 flex-none place-items-center rounded-[var(--radius-sm)] text-11px font-700"
            :class="task.status === 'pending' ? 'bg-surface-3 text-ink-soft' : 'bg-ok text-white'"
          >
            {{ task.status === 'pending' ? index + 1 : '✓' }}
          </span>
          <div class="min-w-48 flex-1">
            <div class="truncate text-12px font-700 text-ink">
              {{ task.title }}
            </div>
            <div class="truncate text-11px text-ink-soft">
              {{ task.description || '—' }}
            </div>
          </div>
          <span class="chip bg-panel text-ink-soft">{{ task.responsible || '待指定' }}</span>
          <ProjectTaskFiles :task="task" :project-tasks="tasks" />
        </div>
      </div>
      <div v-else class="border border-dashed border-line-strong px-4 py-5 text-center text-12px text-ink-faint">
        该阶段任务动态生成，暂无固定任务。
      </div>
    </div>

    <ProjectPhaseEditor
      v-model:open="showEditor"
      :project-id="projectId"
      :tasks="tasks"
      @save="saveTasks"
    />
  </section>
</template>

<style scoped>
.project-phase-flow {
  position: relative;
}

.project-phase-flow::before {
  position: absolute;
  top: 0.875rem;
  right: calc(100% / 12);
  left: calc(100% / 12);
  height: 2px;
  background: var(--line-strong);
  content: '';
}

.project-phase-node {
  min-height: 1.875rem;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}

.project-phase-node:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
</style>
