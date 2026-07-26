<script setup lang="ts">
import type { FileRefDraft, FileRefRecord } from '~/lib/forms/file-refs'
import type { PhaseTask } from '~/stores/phase-task'
import { isTauri } from '@tauri-apps/api/core'
import { computed, shallowRef } from 'vue'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { toErrorMessage } from '~/lib/util/error'
import { formatFileSize } from '~/lib/util/file'

const props = defineProps<{
  task: PhaseTask
  projectTasks: readonly PhaseTask[]
}>()

const store = usePhaseTaskStore()
const { confirm, error, success, undoToast, warning } = useKitUI()
const { preview, download } = useFileRefAccess()
const expanded = shallowRef(false)
const uploading = shallowRef(false)
const desktopPicker = isTauri()

const attachments = computed(() =>
  props.task.id ? store.files.filter(file => file.ownerId === props.task.id) : [],
)

async function saveDrafts(drafts: FileRefDraft[]) {
  const available = Math.max(9 - attachments.value.length, 0)
  if (drafts.length > available)
    warning(`每个阶段任务最多保留 9 份文件，本次只登记前 ${available} 份`)
  const accepted = drafts.slice(0, available)
  if (!accepted.length)
    return
  uploading.value = true
  try {
    await store.addFiles(props.task, accepted, props.projectTasks)
    expanded.value = true
    success(`已登记 ${accepted.length} 份阶段文件`)
  }
  catch (cause) {
    error(`阶段文件登记失败：${toErrorMessage(cause)}`)
  }
  finally {
    uploading.value = false
  }
}

async function handleBrowserFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...(input.files ?? [])]
  input.value = ''
  if (!selected.length)
    return
  try {
    await saveDrafts(await Promise.all(selected.map(file =>
      fileRefDraftFromFile(file, { uploader: '当前用户' }),
    )))
  }
  catch (cause) {
    error(`读取附件失败：${toErrorMessage(cause)}`)
  }
}

async function pickNativeFiles() {
  try {
    const [{ open }, { stat }, { basename }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/api/path'),
    ])
    const selected = await open({ multiple: true, directory: false })
    const paths = selected == null ? [] : Array.isArray(selected) ? selected : [selected]
    const drafts = await Promise.all(paths.map(async filePath => ({
      fileName: await basename(filePath),
      filePath,
      fileSize: (await stat(filePath)).size,
      uploader: '当前用户',
    })))
    await saveDrafts(drafts)
  }
  catch (cause) {
    error(`选择阶段文件失败：${toErrorMessage(cause)}`)
  }
}

async function remove(file: FileRefRecord) {
  const approved = await confirm({
    variant: 'simple',
    title: `删除阶段文件「${file.fileName}」？`,
    message: '文件会从任务和项目文件柜同时移除，可通过消息撤回。',
    confirmLabel: '删除文件',
  })
  if (!approved)
    return
  try {
    const logIds = await store.removeFile(props.task.id, file.id)
    undoToast(
      `已删除阶段文件「${file.fileName}」`,
      () => store.undoFileChanges(logIds),
    )
  }
  catch (cause) {
    error(`阶段文件删除失败：${toErrorMessage(cause)}`)
  }
}
</script>

<template>
  <div class="contents">
    <div class="flex flex-wrap items-center justify-end gap-1.5">
      <button
        type="button"
        class="btn-secondary text-11px"
        :aria-expanded="expanded"
        :aria-label="`${task.title}文件，共 ${attachments.length} 份`"
        @click="expanded = !expanded"
      >
        <span class="i-lucide-paperclip mr-1 text-11px" aria-hidden="true" />
        文件 {{ attachments.length }}
      </button>
      <button
        v-if="desktopPicker"
        type="button"
        class="btn-secondary text-11px"
        :disabled="uploading"
        @click="pickNativeFiles"
      >
        <span class="i-lucide-upload mr-1 text-11px" aria-hidden="true" />
        {{ uploading ? '登记中' : '上传' }}
      </button>
      <label
        v-else
        class="btn-secondary cursor-pointer text-11px"
        :class="uploading ? 'pointer-events-none opacity-60' : ''"
      >
        <span class="i-lucide-upload mr-1 text-11px" aria-hidden="true" />
        {{ uploading ? '登记中' : '上传' }}
        <input
          type="file"
          multiple
          class="sr-only"
          :aria-label="`上传${task.title}文件`"
          @change="handleBrowserFiles"
        >
      </label>
    </div>

    <div
      v-if="expanded"
      class="basis-full space-y-1.5 rounded-[var(--radius-control)] border border-line bg-panel p-2.5"
      :aria-label="`${task.title}文件列表`"
    >
      <div
        v-if="attachments.length === 0"
        class="py-2 text-center text-11px text-ink-faint"
      >
        该任务尚未登记文件
      </div>
      <div
        v-for="file in attachments"
        :key="file.id"
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-sm)] bg-surface-2 px-2.5 py-2"
      >
        <span class="i-lucide-file-text flex-none text-13px text-ink-faint" aria-hidden="true" />
        <span class="min-w-40 flex-1 truncate text-11px font-600 text-ink" :title="file.fileName">
          {{ file.fileName }}
        </span>
        <span class="text-10px text-ink-faint">{{ formatFileSize(file.fileSize) }}</span>
        <span class="text-10px text-ink-faint">{{ file.uploader || '未记录上传人' }}</span>
        <button type="button" class="cell--link text-11px" @click="preview(file)">
          预览
        </button>
        <button type="button" class="cell--link text-11px" @click="download(file)">
          下载
        </button>
        <button type="button" class="text-11px text-danger" @click="remove(file)">
          删除
        </button>
      </div>
    </div>
  </div>
</template>
