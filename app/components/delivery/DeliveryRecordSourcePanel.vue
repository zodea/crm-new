<script setup lang="ts">
import type { DeliveryRecordSourceFile } from '~/stores/delivery-record'
import { isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'

const props = withDefaults(defineProps<{
  recordId: string
  minHeight?: string
}>(), {
  minHeight: '480px',
})

const emit = defineEmits<{
  saved: [recordId: string]
}>()

const store = useDeliveryRecordStore()
const { confirm, success, warning, error } = useKitUI()
const sourceFile = shallowRef<DeliveryRecordSourceFile | null>(null)
const loading = shallowRef(true)
const saving = shallowRef(false)
const loadError = shallowRef('')
const previewError = shallowRef('')
const rotation = shallowRef(0)
let loadSequence = 0

const panelStyle = computed(() => ({ minHeight: props.minHeight }))
const imageStyle = computed(() => ({ transform: `rotate(${rotation.value}deg)` }))
const sourceKind = computed<'pdf' | 'image' | 'unsupported'>(() => {
  const source = sourceFile.value
  if (source?.mimeType === 'application/pdf' || /\.pdf$/i.test(source?.fileName ?? ''))
    return 'pdf'
  if (source?.mimeType.startsWith('image/') || /\.(?:png|jpe?g)$/i.test(source?.fileName ?? ''))
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
  const sequence = ++loadSequence
  loading.value = true
  loadError.value = ''
  previewError.value = ''
  rotation.value = 0
  try {
    const source = await store.loadSourceFile(props.recordId)
    if (sequence === loadSequence)
      sourceFile.value = source
  }
  catch (caught) {
    if (sequence !== loadSequence)
      return
    sourceFile.value = null
    loadError.value = caught instanceof Error ? caught.message : '送货单原件加载失败'
  }
  finally {
    if (sequence === loadSequence)
      loading.value = false
  }
}

const { open: openFilePicker, onChange: onFilesPicked } = useFileDialog({
  accept: RECOGNIZABLE_FILE_ACCEPT,
  multiple: false,
  reset: true,
})

onFilesPicked(async (files) => {
  const file = files?.[0]
  if (!file)
    return
  if (!isRecognizableFile(file.name)) {
    warning('请选择 PDF、PNG、JPG 或 JPEG 文件')
    return
  }

  const replacing = sourceFile.value != null
  if (replacing) {
    const confirmed = await confirm({
      variant: 'simple',
      title: '替换送货单原件',
      message: `确认用「${file.name}」替换当前原件？结构化单据和材料明细不会改变。`,
      confirmLabel: '替换原件',
    })
    if (!confirmed)
      return
  }

  saving.value = true
  try {
    await store.saveSourceFile(props.recordId, file)
    await loadSourceFile()
    emit('saved', props.recordId)
    success(replacing ? '送货单原件已替换' : '送货单原件已补传')
  }
  catch (caught) {
    error(caught instanceof Error ? caught.message : '送货单原件保存失败')
  }
  finally {
    saving.value = false
  }
})

function rotate(delta: number) {
  rotation.value = (rotation.value + delta + 360) % 360
}

watch(() => props.recordId, loadSourceFile, { immediate: true })
onActivated(loadSourceFile)
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
          {{ sourceFile.mimeType || (sourceKind === 'pdf' ? 'PDF' : '图片') }} · {{ fileSizeLabel }} · 本地 SQLite
        </div>
        <div v-else class="text-9px text-ink-faint">
          本地 SQLite 归档原件
        </div>
      </div>
      <div class="flex-1" />
      <template v-if="sourceFile && sourceKind === 'image' && previewUrl">
        <button type="button" class="icon-btn h-7 w-7" title="向左旋转预览" @click="rotate(-90)">
          <span class="i-lucide-rotate-ccw text-12px" />
        </button>
        <button type="button" class="icon-btn h-7 w-7" title="向右旋转预览" @click="rotate(90)">
          <span class="i-lucide-rotate-cw text-12px" />
        </button>
      </template>
      <button
        v-if="sourceFile"
        type="button"
        class="btn-secondary h-7 px-2 text-10px"
        :disabled="saving"
        @click="openFilePicker()"
      >
        <span class="i-lucide-replace mr-1 text-11px" />{{ saving ? '保存中…' : '替换原件' }}
      </button>
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
          <button type="button" class="btn-secondary" @click="loadSourceFile">
            <span class="i-lucide-refresh-cw mr-1 text-12px" />重新加载
          </button>
          <button type="button" class="btn-accent" :disabled="saving" @click="openFilePicker()">
            <span class="i-lucide-upload mr-1 text-12px" />重新补传原件
          </button>
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
        <button type="button" class="btn-accent mt-3" :disabled="saving" @click="openFilePicker()">
          <span class="i-lucide-replace mr-1 text-12px" />选择其他原件
        </button>
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
        <button type="button" class="btn-accent mt-3" :disabled="saving" @click="openFilePicker()">
          <span class="i-lucide-upload mr-1 text-12px" />{{ saving ? '保存中…' : '补传原件' }}
        </button>
      </div>
    </div>
  </section>
</template>
