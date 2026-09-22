<script setup lang="ts">
import type { DeliveryRecordSourceFile } from '~/stores/delivery-record'
import { useFileDialog, useObjectUrl } from '@vueuse/core'
import { computed, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'

const props = withDefaults(defineProps<{
  recordId: string
  assetId?: string | null
  readOnly?: boolean
  minHeight?: string
}>(), {
  minHeight: '480px',
  assetId: undefined,
  readOnly: false,
})

const emit = defineEmits<{
  saved: [recordId: string]
}>()

const store = useDeliveryRecordStore()
const { success, warning, error, exportFile } = useKitUI()
const sourceFile = shallowRef<(DeliveryRecordSourceFile & { assetId?: string }) | null>(null)
const loading = shallowRef(true)
const saving = shallowRef(false)
const loadError = shallowRef('')
const previewError = shallowRef('')
const rotation = shallowRef(0)
const pendingFile = shallowRef<{ file: File, recordId: string, baseVersion?: string } | null>(null)
const revisionReason = shallowRef('')
const downloading = shallowRef(false)
let sourceController: AbortController | null = null
let downloadController: AbortController | null = null
let active = true
let identity = ''
const canChange = computed(() => !props.readOnly && props.assetId === undefined && store.canWrite)

const panelStyle = computed(() => ({ minHeight: props.minHeight }))
const imageStyle = computed(() => ({ transform: `rotate(${rotation.value}deg)` }))
const sourceKind = computed<'pdf' | 'image' | 'unsupported'>(() => {
  const source = sourceFile.value
  if (source?.mimeType === 'application/pdf')
    return 'pdf'
  if (source && ['image/png', 'image/jpeg'].includes(source.mimeType))
    return 'image'
  return 'unsupported'
})
const sourceBlob = computed(() => {
  const source = sourceFile.value
  if (!source || sourceKind.value === 'unsupported')
    return undefined
  const type = source.mimeType || (sourceKind.value === 'pdf' ? 'application/pdf' : 'application/octet-stream')
  return new Blob([Uint8Array.from(source.bytes).buffer], { type })
})
const previewUrl = useObjectUrl(sourceBlob)
const fileSizeLabel = computed(() => {
  const size = sourceFile.value?.fileSize ?? sourceFile.value?.bytes.byteLength ?? 0
  if (size < 1024)
    return `${size} B`
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
})

async function loadSourceFile() {
  sourceController?.abort()
  const controller = new AbortController()
  sourceController = controller
  sourceFile.value = null
  loading.value = true
  loadError.value = ''
  previewError.value = ''
  rotation.value = 0
  try {
    if (props.assetId === null)
      return
    const source = await store.loadSourceFile(props.recordId, { signal: controller.signal, ...(props.assetId ? { assetId: props.assetId } : {}) })
    if (active && !controller.signal.aborted)
      sourceFile.value = source
  }
  catch (caught) {
    if (!active || controller.signal.aborted)
      return
    sourceFile.value = null
    loadError.value = caught instanceof Error ? caught.message : '送货单原件加载失败'
  }
  finally {
    if (!controller.signal.aborted)
      loading.value = false
  }
}

const { open: openFilePicker, onChange: onFilesPicked } = useFileDialog({
  accept: RECOGNIZABLE_FILE_ACCEPT,
  multiple: false,
  reset: true,
})

onFilesPicked((files) => {
  const file = files?.[0]
  if (!file || !active || !canChange.value || saving.value)
    return
  if (!isRecognizableFile(file.name)) {
    warning('请选择 PDF、PNG、JPG 或 JPEG 文件')
    return
  }

  pendingFile.value = { file, recordId: props.recordId, baseVersion: store.byId(props.recordId)?.version }
  revisionReason.value = ''
})

async function saveOriginal() {
  const pending = pendingFile.value
  if (!pending || !canChange.value || saving.value)
    return
  const reason = revisionReason.value.trim()
  if (!reason) {
    warning('请填写原件修订原因')
    return
  }
  saving.value = true
  try {
    await store.saveSourceFile(pending.recordId, pending.file, reason, pending.baseVersion)
    if (!active || pendingFile.value !== pending || props.recordId !== pending.recordId)
      return
    pendingFile.value = null
    revisionReason.value = ''
    await loadSourceFile()
    if (active && props.recordId === pending.recordId) {
      emit('saved', pending.recordId)
      success('原件修订已保存，旧原件保留在历史中')
    }
  }
  catch (caught) {
    if (active && pendingFile.value === pending)
      error(caught instanceof Error ? caught.message : '送货单原件保存失败')
  }
  finally {
    saving.value = false
  }
}

async function downloadOriginal() {
  const source = sourceFile.value
  if (!source || downloading.value)
    return
  const recordId = props.recordId
  const assetId = props.assetId ?? source.assetId
  const controller = new AbortController()
  downloadController = controller
  downloading.value = true
  try {
    await exportFile({
      defaultName: source.fileName,
      mimeType: source.mimeType,
      signal: controller.signal,
      data: async () => {
        const current = await store.loadSourceFile(recordId, { signal: controller.signal, ...(assetId ? { assetId } : {}) })
        if (controller.signal.aborted)
          throw new DOMException('送货原件下载已取消', 'AbortError')
        if (!current)
          throw new Error('当前原件已缺失，请重新读取')
        return current.bytes
      },
    })
  }
  catch (caught) {
    if (!controller.signal.aborted)
      error(caught instanceof Error ? caught.message : '原件下载失败')
  }
  finally {
    if (downloadController === controller) {
      downloadController = null
      downloading.value = false
    }
  }
}

function suspend() {
  active = false
  sourceController?.abort()
  downloadController?.abort()
  sourceFile.value = null
  pendingFile.value = null
  revisionReason.value = ''
}

function cancelDownload() {
  downloadController?.abort()
}

function rotate(delta: number) {
  rotation.value = (rotation.value + delta + 360) % 360
}

watch([() => props.recordId, () => props.assetId, () => store.sourceVersion, () => store.origin], () => {
  const next = JSON.stringify([props.recordId, props.assetId === undefined ? 'current' : ['history', props.assetId], store.origin])
  if (next !== identity) {
    identity = next
    pendingFile.value = null
    revisionReason.value = ''
    downloadController?.abort()
  }
  if (active)
    void loadSourceFile()
}, { immediate: true, flush: 'sync' })
onActivated(() => {
  if (active)
    return
  active = true
  void loadSourceFile()
})
onDeactivated(suspend)
onBeforeUnmount(suspend)
</script>

<template>
  <section
    data-testid="delivery-source-panel"
    class="panel flex min-h-0 min-w-0 flex-col overflow-hidden"
    :style="panelStyle"
    :aria-busy="loading || saving"
  >
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3">
      <div class="min-w-0">
        <div class="truncate text-11px font-700 text-ink" :title="sourceFile?.fileName || '送货单原件'">
          {{ sourceFile?.fileName || '送货单原件' }}
        </div>
        <div v-if="sourceFile" class="text-9px text-ink-faint">
          {{ sourceFile.mimeType }} · {{ fileSizeLabel }}
        </div>
        <div v-else class="text-9px text-ink-faint">
          {{ readOnly ? '原件只读核对' : '归档原件 · 修订保留历史' }}
        </div>
      </div>
      <div class="flex-1" />
      <template v-if="sourceFile && sourceKind === 'image' && previewUrl">
        <KitButton type="button" variant="secondary" class="h-7 w-7" title="向左旋转预览" aria-label="向左旋转预览" @click="rotate(-90)">
          <span class="i-lucide-rotate-ccw text-12px" />
        </KitButton>
        <KitButton type="button" variant="secondary" class="h-7 w-7" title="向右旋转预览" aria-label="向右旋转预览" @click="rotate(90)">
          <span class="i-lucide-rotate-cw text-12px" />
        </KitButton>
      </template>
      <KitButton v-if="sourceFile" variant="secondary" :loading="downloading" @click="downloadOriginal">
        下载原件
      </KitButton>
      <KitButton v-if="downloading" variant="secondary" @click="cancelDownload">
        取消下载
      </KitButton>
      <KitButton
        v-if="sourceFile && canChange"
        type="button"
        class="btn-secondary h-7 px-2 text-10px"
        :disabled="saving"
        @click="openFilePicker()"
      >
        <span class="i-lucide-replace mr-1 text-11px" />{{ saving ? '保存中…' : '替换原件' }}
      </KitButton>
    </div>

    <div v-if="pendingFile && canChange" class="grid gap-2 border-b border-line bg-panel p-3">
      <p class="break-all text-12px">
        {{ pendingFile.file.name }}
      </p>
      <p class="text-11px text-ink-soft">
        确认后新增原件修订；旧原件保留，材料明细不会改变。
      </p>
      <label class="field-block"><span class="field-label">原件修订原因 *</span><textarea v-model="revisionReason" :disabled="saving" rows="2" class="field-input w-full" /></label>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="saving" @click="pendingFile = null; revisionReason = ''">
          取消补传
        </KitButton>
        <KitButton :loading="saving" @click="saveOriginal">
          确认保存原件
        </KitButton>
      </div>
    </div>

    <div class="relative min-h-0 flex-1 overflow-auto bg-[#e8eaed] p-3">
      <div v-if="loading" class="flex h-full min-h-80 flex-col items-center justify-center text-ink-faint">
        <span class="i-lucide-loader-circle mb-2 animate-spin text-26px text-brand" />
        <p class="text-11px">
          正在加载送货单原件…
        </p>
      </div>

      <div v-else-if="loadError" role="alert" class="flex h-full min-h-80 flex-col items-center justify-center px-6 text-center">
        <span class="i-lucide-file-warning mb-2 text-26px text-danger" />
        <p class="text-12px font-700 text-ink">
          原件加载失败
        </p>
        <p class="mt-1 max-w-90 text-10px text-ink-faint">
          {{ loadError }}
        </p>
        <div class="mt-3 flex items-center gap-2">
          <KitButton type="button" variant="secondary" @click="loadSourceFile">
            <span class="i-lucide-refresh-cw mr-1 text-12px" />重新加载
          </KitButton>
          <KitButton v-if="canChange" type="button" :disabled="saving" @click="openFilePicker()">
            <span class="i-lucide-upload mr-1 text-12px" />重新补传原件
          </KitButton>
        </div>
      </div>

      <div
        v-else-if="sourceFile && (sourceKind === 'unsupported' || previewError)"
        role="alert"
        class="flex h-full min-h-80 flex-col items-center justify-center px-6 text-center"
      >
        <span class="i-lucide-file-warning mb-2 text-26px text-warn" />
        <p class="text-12px font-700 text-ink">
          当前原件无法预览
        </p>
        <p class="mt-1 max-w-90 text-10px text-ink-faint">
          {{ previewError || `不支持的文件类型：${sourceFile.mimeType || '未知'}` }}
        </p>
        <KitButton v-if="canChange" type="button" class="mt-3" :disabled="saving" @click="openFilePicker()">
          <span class="i-lucide-replace mr-1 text-12px" />选择其他原件
        </KitButton>
      </div>

      <template v-else-if="sourceFile && previewUrl">
        <iframe
          v-if="sourceKind === 'pdf'"
          data-testid="delivery-source-pdf"
          :src="previewUrl"
          :title="`${sourceFile.fileName} 原始 PDF`"
          class="h-full min-h-120 w-full border-0 bg-white shadow-sm"
        />
        <div v-else class="flex min-h-full items-center justify-center">
          <img
            data-testid="delivery-source-image"
            :src="previewUrl"
            :alt="`${sourceFile.fileName} 原始图片`"
            class="max-h-full max-w-full origin-center bg-white object-contain shadow-sm transition-transform duration-200"
            :style="imageStyle"
            @error="previewError = '图片内容损坏或无法读取'"
          >
        </div>
      </template>

      <div
        v-else
        data-testid="delivery-source-empty"
        class="flex h-full min-h-80 flex-col items-center justify-center px-6 text-center"
      >
        <span class="i-lucide-image-off mb-2 text-28px text-ink-faint" />
        <p class="text-12px font-700 text-ink">
          历史记录未保存原件
        </p>
        <p class="mt-1 max-w-90 text-10px leading-5 text-ink-faint">
          这是旧归档记录或原件曾缺失。补传 PDF 或图片后，即可在详情和编辑时对照核验。
        </p>
        <KitButton v-if="canChange" type="button" class="mt-3" :disabled="saving" @click="openFilePicker()">
          <span class="i-lucide-upload mr-1 text-12px" />{{ saving ? '保存中…' : '补传原件' }}
        </KitButton>
      </div>
    </div>
  </section>
</template>
