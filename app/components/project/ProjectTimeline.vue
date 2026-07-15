<script setup lang="ts">
import type { PhaseCardStatus } from '~/lib/project/phases'
import type { PhaseTask } from '~/stores/phase-task'
import { derivePhaseViews } from '~/lib/project/phases'

const props = defineProps<{
  projectId: string
}>()

const store = usePhaseTaskStore()
const { info, success, error } = useKitUI()
const showEditor = shallowRef(false)
const openPhase = shallowRef<number | null>(null)

const tasks = computed(() => store.byProject(props.projectId))
const phaseViews = computed(() => derivePhaseViews(tasks.value))
const activePhaseView = computed(() =>
  openPhase.value == null ? undefined : phaseViews.value[openPhase.value],
)

const STATUS_VIEW: Record<PhaseCardStatus, { icon: string, card: string, text: string }> = {
  done: {
    icon: 'i-lucide-circle-check',
    card: 'border-ok bg-ok-soft',
    text: 'text-ok-ink',
  },
  active: {
    icon: 'i-lucide-loader-circle',
    card: 'border-brand bg-brand-soft',
    text: 'text-brand-deep',
  },
  pending: {
    icon: 'i-lucide-clock-3',
    card: 'border-line-strong bg-panel',
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
    await store.saveProject(props.projectId, next)
    showEditor.value = false
    success('阶段任务已更新')
  }
  catch {
    error('阶段任务保存失败，请重试')
  }
}

function attachmentPlaceholder(action: '上传' | '查看', title: string) {
  info(`${action}「${title}」附件将在文件管理工序接入`)
}

onMounted(() => store.ensureProject(props.projectId))
</script>

<template>
  <section class="mb-4" aria-labelledby="project-phase-title">
    <SectionHeader>
      <span id="project-phase-title">阶段时间线 · 任务文件</span>
      <template #extra>
        <div class="flex items-center gap-2.5">
          <span class="text-11px text-ink-faint">点阶段卡展开任务</span>
          <button class="btn-secondary text-12px" @click="showEditor = true">
            <span class="i-lucide-square-pen mr-1 text-12px" aria-hidden="true" />编辑阶段
          </button>
        </div>
      </template>
    </SectionHeader>

    <div class="overflow-x-auto pb-1">
      <div class="grid min-w-[780px] grid-cols-6 gap-2">
        <button
          v-for="view in phaseViews"
          :key="view.name"
          class="min-w-0 rounded-[var(--radius-btn)] border-2 px-3 py-2.5 text-left transition-shadow"
          :class="[
            STATUS_VIEW[view.status].card,
            openPhase === view.index ? 'shadow-[0_0_0_3px_var(--brand-ring)]' : '',
          ]"
          @click="togglePhase(view.index)"
        >
          <div class="flex min-w-0 items-center gap-1.5" :class="STATUS_VIEW[view.status].text">
            <span :class="STATUS_VIEW[view.status].icon" class="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            <span class="truncate text-12px font-800">{{ view.name }}</span>
          </div>
          <div class="mt-2 font-mono text-17px font-800" :class="STATUS_VIEW[view.status].text">
            {{ view.total ? `${view.done}/${view.total}` : '动态' }}
            <span class="ml-1 text-10px font-600 text-ink-faint">任务</span>
          </div>
        </button>
      </div>
    </div>

    <div v-if="activePhaseView" class="mt-3 border-t border-line pt-3">
      <template v-if="activePhaseView">
        <div class="mb-2 flex items-center gap-2">
          <h4 class="text-13px font-700 text-ink">
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
            class="flex items-center gap-3 rounded-[var(--radius-sm)] border border-line px-3 py-2"
            :class="task.status === 'pending' ? 'bg-surface-2' : 'bg-ok-soft'"
          >
            <span
              class="grid h-6 w-6 flex-none place-items-center rounded-[var(--radius-sm)] text-11px font-700"
              :class="task.status === 'pending' ? 'bg-surface-3 text-ink-soft' : 'bg-ok text-white'"
            >
              {{ task.status === 'pending' ? index + 1 : '✓' }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-12px font-700 text-ink">
                {{ task.title }}
              </div>
              <div class="truncate text-11px text-ink-soft">
                {{ task.description || '—' }}
              </div>
            </div>
            <span class="chip bg-panel text-ink-soft">{{ task.responsible || '待指定' }}</span>
            <button class="btn-secondary text-11px" @click="attachmentPlaceholder('上传', task.title)">
              <span class="i-lucide-upload mr-1 text-11px" aria-hidden="true" />上传
            </button>
            <button class="btn-secondary text-11px" @click="attachmentPlaceholder('查看', task.title)">
              <span class="i-lucide-eye mr-1 text-11px" aria-hidden="true" />查看
            </button>
          </div>
        </div>
        <div v-else class="rounded-[var(--radius-btn)] border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center text-12px text-ink-faint">
          该阶段任务动态生成，暂无固定任务。
        </div>
      </template>
    </div>

    <ProjectPhaseEditor
      v-model:open="showEditor"
      :project-id="projectId"
      :tasks="tasks"
      @save="saveTasks"
    />
  </section>
</template>
