<script setup lang="ts">
import type { PhaseTask } from '~/stores/phase-task'
import { computed, shallowRef } from 'vue'
import { PROJECT_PHASES } from '~/lib/project/phases'
import { formatFileSize } from '~/lib/util/file'

const props = defineProps<{
  projectId: string
  tasks: readonly PhaseTask[]
}>()

const store = usePhaseTaskStore()
const { preview, download } = useFileRefAccess()
const expanded = shallowRef(true)

const projectTasks = computed(() =>
  props.tasks.filter(task => task.projectId === props.projectId && task.id),
)
const taskMap = computed(() =>
  new Map(projectTasks.value.map(task => [task.id, task])),
)
const files = computed(() => store.files
  .filter(file => taskMap.value.has(file.ownerId))
  .map(file => ({
    ...file,
    task: taskMap.value.get(file.ownerId)!,
  }))
  .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt)),
)

function uploadedAt(value: string): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—'
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="project-file-list-title">
    <button
      type="button"
      class="flex w-full items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-left"
      :aria-expanded="expanded"
      aria-controls="project-file-list-content"
      @click="expanded = !expanded"
    >
      <span class="i-lucide-folder-kanban text-14px text-brand" aria-hidden="true" />
      <span id="project-file-list-title" class="text-13px font-700 text-ink">项目文件柜</span>
      <span class="chip bg-surface-3 text-ink-soft">{{ files.length }} 份</span>
      <span
        class="ml-auto text-13px text-ink-faint"
        :class="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="expanded"
      id="project-file-list-content"
      class="min-w-0 overflow-x-auto"
    >
      <div
        v-if="files.length === 0"
        class="bg-surface-2 px-4 py-6 text-center text-12px text-ink-faint"
      >
        尚未从阶段任务登记项目文件
      </div>
      <div v-else class="min-w-64 divide-y divide-line">
        <div
          v-for="file in files"
          :key="file.id"
          class="grid min-w-0 gap-2 bg-panel px-3 py-2.5 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,0.8fr)_auto]"
        >
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="i-lucide-file-text flex-none text-13px text-ink-faint" aria-hidden="true" />
              <span class="truncate text-12px font-700 text-ink" :title="file.fileName">
                {{ file.fileName }}
              </span>
            </div>
            <div class="mt-0.5 pl-5 text-10px text-ink-faint">
              {{ formatFileSize(file.fileSize) }} · {{ file.uploader || '未记录上传人' }} · {{ uploadedAt(file.uploadedAt) }}
            </div>
          </div>
          <div class="min-w-0 text-11px text-ink-soft">
            <span class="font-600 text-ink">
              {{ PROJECT_PHASES[file.task.phaseIndex]?.name || '未分阶段' }}
            </span>
            <span class="mx-1 text-ink-faint">/</span>
            <span class="break-words">{{ file.task.title }}</span>
          </div>
          <div class="flex items-center justify-end gap-2">
            <button type="button" class="cell--link text-11px" @click="preview(file)">
              预览
            </button>
            <button type="button" class="cell--link text-11px" @click="download(file)">
              下载
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
