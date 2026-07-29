<script setup lang="ts">
import type { ScheduleProcessLibraryTaskDraft } from '~/lib/schedule/process-library'
import { computed, shallowRef, watch } from 'vue'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'

interface PlannedWindow {
  key: string
  plannedStart: string
  plannedFinish: string
}

const props = defineProps<{
  task: ScheduleProcessLibraryTaskDraft | null
  tasks: readonly ScheduleProcessLibraryTaskDraft[]
  plannedWindows?: readonly PlannedWindow[]
}>()

const emit = defineEmits<{
  save: [predecessorKey: string | null]
  restore: []
}>()

const open = defineModel<boolean>('open', { required: true })
const selectedKey = shallowRef<string | null>(null)

const targetIndex = computed(() =>
  props.task ? props.tasks.findIndex(task => task.key === props.task!.key) : -1,
)
const windowByKey = computed(() =>
  new Map((props.plannedWindows ?? []).map(window => [window.key, window])),
)
const targetWindow = computed(() =>
  props.task ? windowByKey.value.get(props.task.key) : null,
)
const candidates = computed(() => props.tasks.filter((candidate, index) => {
  if (!props.task || candidate.key === props.task.key)
    return false
  const candidateWindow = windowByKey.value.get(candidate.key)
  if (candidateWindow && targetWindow.value)
    return candidateWindow.plannedStart < targetWindow.value.plannedStart
  return index < targetIndex.value
}))
const disabledPredecessor = computed(() =>
  props.task?.predecessorDisabled && props.task.predecessorKey
    ? props.tasks.find(task => task.key === props.task!.predecessorKey) ?? null
    : null,
)
const canRestore = computed(() =>
  Boolean(
    disabledPredecessor.value
    && candidates.value.some(candidate => candidate.key === disabledPredecessor.value!.key),
  ),
)
const canSave = computed(() =>
  selectedKey.value === null
  || candidates.value.some(candidate => candidate.key === selectedKey.value),
)

watch(open, (isOpen) => {
  if (isOpen)
    selectedKey.value = props.task?.predecessorKey ?? null
})

function plannedLabel(key: string) {
  const window = windowByKey.value.get(key)
  return window ? `${window.plannedStart} — ${window.plannedFinish}` : '位于当前工序之前'
}

function close() {
  open.value = false
}

function save() {
  if (!canSave.value)
    return
  emit('save', selectedKey.value)
  close()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close="false"
      class="flex max-h-[min(78dvh,620px)] w-[min(440px,calc(100dvw-24px))] flex-col overflow-hidden p-0"
    >
      <header class="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div class="min-w-0">
          <DialogTitle>设置前置工序<span v-if="task"> · {{ task.name }}</span></DialogTitle>
          <DialogDescription class="mt-1 text-11px text-ink-faint">
            只列出计划日期早于当前工序的候选。
          </DialogDescription>
        </div>
        <Button size="icon" variant="ghost" aria-label="关闭前置工序设置" @click="close">
          <span class="i-lucide-x" aria-hidden="true" />
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        <section
          v-if="disabledPredecessor"
          class="mb-4 rounded-lg border border-dashed border-line-strong bg-surface-2 p-3"
        >
          <div class="text-12px font-800 text-ink">
            已置灰关系
          </div>
          <p class="mt-1 text-11px text-ink-faint line-through">
            {{ disabledPredecessor.name }} → {{ task?.name }}
          </p>
          <Button
            class="mt-2"
            size="sm"
            :disabled="!canRestore"
            @click="emit('restore'); close()"
          >
            重新启用
          </Button>
          <p v-if="!canRestore" class="mt-1 text-10px text-warning">
            请先把原前置工序调整到当前工序之前。
          </p>
        </section>

        <fieldset>
          <legend class="field-label">
            日期更早的工序
          </legend>
          <div class="mt-2 grid gap-2">
            <label class="candidate-row">
              <input v-model="selectedKey" type="radio" :value="null">
              <span><b>不设置前置</b><small>当前工序独立排程</small></span>
            </label>
            <label
              v-for="candidate in candidates"
              :key="candidate.key"
              class="candidate-row"
            >
              <input v-model="selectedKey" type="radio" :value="candidate.key">
              <span>
                <b>{{ candidate.name }}</b>
                <small>{{ plannedLabel(candidate.key) }}</small>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <footer class="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button @click="close">
          取消
        </Button>
        <Button variant="accent" :disabled="!canSave" @click="save">
          保存前置关系
        </Button>
      </footer>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.candidate-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  padding: 9px 10px;
  cursor: pointer;
}

.candidate-row:has(input:checked) {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.candidate-row span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.candidate-row b {
  color: var(--ink);
  font-size: 12px;
}

.candidate-row small {
  color: var(--ink-faint);
  font-size: 10px;
}
</style>
