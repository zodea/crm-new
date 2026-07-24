<script setup lang="ts">
import type { PhaseTaskStatus } from '~/lib/project/phases'
import type { PhaseTask } from '~/stores/phase-task'
import { PROJECT_PHASES } from '~/lib/project/phases'

const props = defineProps<{
  projectId: string
  tasks: readonly PhaseTask[]
}>()

const emit = defineEmits<{
  save: [tasks: PhaseTask[]]
}>()

interface EditableTask extends PhaseTask {
  editorKey: string
}

const open = defineModel<boolean>('open', { required: true })
const { warning } = useKitUI()
const draft = ref<EditableTask[]>([])
let nextKey = 0

const STATUS_OPTIONS: { value: PhaseTaskStatus, label: string }[] = [
  { value: 'pending', label: '待上传' },
  { value: 'uploaded', label: '已上传' },
  { value: 'confirmed', label: '已确认' },
]

watch([open, () => props.tasks], ([isOpen]) => {
  if (!isOpen)
    return
  draft.value = props.tasks.map(task => ({ ...task, editorKey: task.id || `draft-${nextKey++}` }))
})

function tasksFor(phaseIndex: number): EditableTask[] {
  return draft.value.filter(task => task.phaseIndex === phaseIndex)
}

function addTask(phaseIndex: number) {
  draft.value.push({
    id: '',
    editorKey: `new-${nextKey++}`,
    projectId: props.projectId,
    phaseIndex,
    taskIndex: tasksFor(phaseIndex).length,
    title: '',
    description: '',
    responsible: '',
    status: 'pending',
  })
}

function removeTask(editorKey: string) {
  draft.value = draft.value.filter(task => task.editorKey !== editorKey)
}

function save() {
  if (draft.value.some(task => !task.title.trim())) {
    warning('阶段任务名称不能为空')
    return
  }
  emit('save', draft.value.map(({ editorKey: _, ...task }) => ({
    ...task,
    title: task.title.trim(),
    description: task.description.trim(),
    responsible: task.responsible.trim(),
  })))
}
</script>

<template>
  <FormDialog
    :open="open"
    title="编辑阶段任务 · 全部六阶段"
    :sections="PROJECT_PHASES.map((phase, index) => ({ key: `phase-${index}`, label: phase.name }))"
    save-label="保存阶段任务"
    width="min(1120px, 96vw)"
    @save="save"
    @cancel="open = false"
  >
    <div class="phase-editor">
      <section
        v-for="(phase, phaseIndex) in PROJECT_PHASES"
        :id="`form-section-phase-${phaseIndex}`"
        :key="phase.name"
        class="mb-7 last:mb-0"
      >
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 class="field-group-title mb-0!">
              {{ phaseIndex + 1 }}. {{ phase.name }}
            </h4>
            <p class="mt-1 text-11px text-ink-faint">
              {{ tasksFor(phaseIndex).length }} 项阶段资料 checklist
            </p>
          </div>
          <button type="button" class="btn-secondary text-12px" @click="addTask(phaseIndex)">
            <span class="i-lucide-plus mr-1 text-12px" aria-hidden="true" />新增任务
          </button>
        </div>

        <div v-if="tasksFor(phaseIndex).length" class="space-y-2">
          <div
            v-for="task in tasksFor(phaseIndex)"
            :key="task.editorKey"
            :data-phase-task-id="task.id || task.editorKey"
            class="phase-task-row grid items-end gap-2 rounded-[var(--radius-btn)] border border-line bg-surface-2 p-2.5"
          >
            <label class="min-w-0">
              <span class="field-label">任务名称 *</span>
              <input v-model="task.title" class="field-input w-full" placeholder="如：开工报告及开工令">
            </label>
            <label class="min-w-0">
              <span class="field-label">说明</span>
              <input v-model="task.description" class="field-input w-full" placeholder="资料要求或归档说明">
            </label>
            <label>
              <span class="field-label">负责人</span>
              <input v-model="task.responsible" class="field-input w-full" placeholder="资料员">
            </label>
            <label>
              <span class="field-label">状态</span>
              <select v-model="task.status" class="field-input w-full">
                <option v-for="option in STATUS_OPTIONS" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <button type="button" class="phase-task-row__remove icon-btn-danger mb-0.5" title="移除任务" @click="removeTask(task.editorKey)">
              <span class="i-lucide-trash-2 text-13px" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div v-else class="rounded-[var(--radius-btn)] border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center text-12px text-ink-faint">
          该阶段暂无固定任务，可按实际情况新增动态 checklist。
        </div>
      </section>
    </div>
  </FormDialog>
</template>

<style scoped>
.phase-editor {
  container-type: inline-size;
}

.phase-task-row {
  grid-template-columns: minmax(11.25rem, 1.2fr) minmax(13.75rem, 1.6fr) minmax(7.5rem, 0.7fr) minmax(6.875rem, 0.65fr) 2rem;
}

@container (max-width: 50rem) {
  .phase-task-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .phase-task-row__remove {
    grid-column: 1 / -1;
    justify-self: end;
  }
}

@container (max-width: 32rem) {
  .phase-task-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .phase-task-row__remove {
    grid-column: 1;
  }
}
</style>
