<script setup lang="ts">
import type { PdfPreviewPage } from '~/lib/invoice/pdf-preview'
import type { InvoiceRecognitionField } from '~/lib/invoice/recognition-changes'
import type { InvoiceRegionHighlightGroup, PreviewRotation } from '~/lib/invoice/recognition-regions'
import { useElementSize, useObjectUrl, usePreferredReducedMotion } from '@vueuse/core'
import { computed, nextTick, onScopeDispose, shallowRef, toRef, useTemplateRef, watch } from 'vue'
import { renderPdfPreviewPages } from '~/lib/invoice/pdf-preview'
import { rotatedFrame, rotateNormalizedBox } from '~/lib/invoice/recognition-regions'

// 发票原图预览（工作台中栏、编辑页左栏共用）：PDF 逐页渲染、图片直出，可缩放、左右旋转，不修改原件。
// 可叠加识别区域框（块级，不是字段级）：compare = 重新识别草稿常驻标出变动字段；focus = 首次识别只框当前
// 聚焦/悬停的字段。activeKey 对应的框强调并在原图区域内滚进视野。缩放、旋转、页码都由同一份 0~1 坐标换算。
const props = withDefaults(defineProps<{
  file: File
  /** 区域叠加方式；缺省为普通预览 */
  mode?: 'compare' | 'focus'
  groups?: readonly InvoiceRegionHighlightGroup[]
  unlocated?: readonly InvoiceRecognitionField[]
  activeKey?: string | null
  /** 本机 OCR 帧；提供时必须与当前预览的页面尺寸和方向一致。 */
  frames?: readonly { pageIndex: number, width: number, height: number, source: 'image' | 'pdf-render' }[]
}>(), { mode: undefined, groups: () => [], unlocated: () => [], activeKey: null })
const emit = defineEmits<{ verifiedPages: [pages: number[]] }>()

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const
const zoomIndex = shallowRef(2)
const zoom = computed(() => ZOOM_STEPS[zoomIndex.value]!)
const rotation = shallowRef<PreviewRotation>(0)

const isPdf = computed(() => props.file.type === 'application/pdf' || /\.pdf$/i.test(props.file.name))
const imageUrl = useObjectUrl(computed(() => isPdf.value ? undefined : props.file))
const imageSize = shallowRef<{ width: number, height: number } | null>(null)
const imageFailed = shallowRef(false)
const pdfSizeMismatch = shallowRef(false)
const pdfPages = shallowRef<PdfPreviewPage[]>([])
const loadedPdfPages = shallowRef<ReadonlySet<number>>(new Set())
const pdfTotalPages = shallowRef(0)
const pdfState = shallowRef<'idle' | 'loading' | 'failed'>('idle')
/** 重试计数：PDF 重新渲染、图片重新挂载 */
const reloadToken = shallowRef(0)
const scroller = useTemplateRef<HTMLElement>('scroller')
const retryButton = useTemplateRef<HTMLButtonElement>('retryButton')

function revokePdfPages() {
  pdfPages.value.forEach(page => URL.revokeObjectURL(page.url))
  pdfPages.value = []
  loadedPdfPages.value = new Set()
  pdfTotalPages.value = 0
}

watch(() => props.file, () => {
  rotation.value = 0
})

watch([() => props.file, reloadToken], async ([file, reload], _, onCleanup) => {
  let cancelled = false
  onCleanup(() => {
    cancelled = true
  })
  revokePdfPages()
  imageSize.value = null
  imageFailed.value = false
  pdfSizeMismatch.value = false
  if (!isPdf.value)
    return
  pdfState.value = 'loading'
  try {
    const result = await renderPdfPreviewPages(file)
    await nextTick()
    if (cancelled || file !== props.file || reload !== reloadToken.value) {
      result.pages.forEach(page => URL.revokeObjectURL(page.url))
      return
    }
    pdfPages.value = result.pages
    pdfTotalPages.value = result.totalPages
    pdfState.value = result.pages.length ? 'idle' : 'failed'
  }
  catch {
    await nextTick()
    if (!cancelled && file === props.file && reload === reloadToken.value)
      pdfState.value = 'failed'
  }
}, { immediate: true })
onScopeDispose(revokePdfPages)

const failure = computed(() => {
  if (isPdf.value && pdfState.value === 'failed')
    return 'PDF 无法在此渲染（文件可能已损坏、加密或不是有效的 PDF）'
  if (isPdf.value && pdfSizeMismatch.value)
    return 'PDF 页图尺寸与渲染结果不一致，无法定位'
  if (isPdf.value && imageFailed.value)
    return 'PDF 页图无法显示，请重新加载原图'
  if (!isPdf.value && imageFailed.value)
    return '图片无法显示（文件可能已损坏或不是浏览器可解码的图片格式）'
  return null
})

function reload() {
  if (typeof document !== 'undefined' && document.activeElement === retryButton.value)
    scroller.value?.focus({ preventScroll: true })
  reloadToken.value++
}

function isCurrentPage(page: { url: string, file: File, reload: number }) {
  if (page.file !== props.file || page.reload !== reloadToken.value)
    return false
  return isPdf.value ? pdfPages.value.some(item => item.url === page.url) : page.url === imageUrl.value
}

function onImageLoad(page: { pageIndex: number, url: string, file: File, reload: number, size: { width: number, height: number } }, event: Event) {
  if (!isCurrentPage(page))
    return
  const image = event.target as HTMLImageElement
  if (isPdf.value) {
    if (!image.naturalWidth || !image.naturalHeight) {
      imageFailed.value = true
      return
    }
    if (image.naturalWidth !== page.size.width || image.naturalHeight !== page.size.height) {
      pdfSizeMismatch.value = true
      return
    }
    if (!loadedPdfPages.value.has(page.pageIndex))
      loadedPdfPages.value = new Set([...loadedPdfPages.value, page.pageIndex])
    return
  }
  if (image.naturalWidth && image.naturalHeight)
    imageSize.value = { width: image.naturalWidth, height: image.naturalHeight }
}

function onImageError(page: { url: string, file: File, reload: number }) {
  if (isCurrentPage(page))
    imageFailed.value = true
}

/** 未取到原始尺寸前按 A4 竖版比例占位，不显示定位框。 */
const A4 = { width: 1, height: Math.SQRT2 }
function frameMatches(pageIndex: number, size: { width: number, height: number }, natural: boolean) {
  if (!natural)
    return false
  if (!props.frames)
    return true
  const matches = props.frames.filter(frame => frame.pageIndex === pageIndex)
  if (matches.length !== 1)
    return false
  const frame = matches[0]!
  if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width <= 0 || frame.height <= 0)
    return false
  if (!isPdf.value)
    return frame.source === 'image' && size.width === frame.width && size.height === frame.height
  if (frame.source !== 'pdf-render')
    return false
  // 渲染采用不同缩放，允许各画布像素向上取整带来的比例误差。
  return Math.abs(size.width / size.height - frame.width / frame.height) <= 2 / Math.min(size.height, frame.height)
}
const pages = computed(() => {
  if (failure.value)
    return []
  const list = isPdf.value
    ? pdfPages.value.map(page => ({ pageIndex: page.pageIndex, url: page.url, size: { width: page.width, height: page.height }, natural: loadedPdfPages.value.has(page.pageIndex) }))
    : imageUrl.value ? [{ pageIndex: 0, url: imageUrl.value, size: imageSize.value ?? A4, natural: !!imageSize.value }] : []
  return list.map(page => ({
    ...page,
    file: props.file,
    reload: reloadToken.value,
    verified: frameMatches(page.pageIndex, page.size, page.natural),
    frame: rotatedFrame(page.size, rotation.value),
    groups: props.groups
      .filter(group => group.pageIndex === page.pageIndex && frameMatches(page.pageIndex, page.size, page.natural))
      .map((group) => {
        const box = rotateNormalizedBox(group.box, rotation.value)
        // 贴近页顶的框把字段名标签放进框内，避免伸出页面被遮住
        return { ...group, box, labelInside: box.y < 0.05, active: !!props.activeKey && group.keys.includes(props.activeKey) }
      }),
  }))
})
const pageCount = computed(() => pages.value.length)
/** PDF 超过预览页数上限：如实提示未显示的页，不静默截断 */
const hiddenPages = computed(() => isPdf.value && pdfPages.value.length && pdfTotalPages.value > pdfPages.value.length
  ? { shown: pdfPages.value.length, total: pdfTotalPages.value }
  : null)

/** 框所在页超出已渲染页数（PDF 只渲染前若干页）时归入未定位，不悬空。 */
const renderedPageIndexes = computed(() => new Set(pages.value.filter(page => page.verified).map(page => page.pageIndex)))
watch(renderedPageIndexes, value => emit('verifiedPages', [...value]), { immediate: true, flush: 'post' })
const offPageLabels = computed(() => props.groups
  .filter(group => pageCount.value > 0 && !renderedPageIndexes.value.has(group.pageIndex))
  .flatMap(group => group.labels))
const unlocatedLabels = computed(() => [...props.unlocated.map(field => field.label), ...offPageLabels.value])
const locatedLabels = computed(() => props.groups
  .filter(group => renderedPageIndexes.value.has(group.pageIndex))
  .flatMap(group => group.labels))
const activeUnlocated = computed(() => {
  const key = props.activeKey
  if (!key)
    return null
  const field = props.unlocated.find(candidate => candidate.key === key)
  if (field)
    return field.label
  const group = props.groups.find(candidate => candidate.keys.includes(key))
  return group && pageCount.value > 0 && !renderedPageIndexes.value.has(group.pageIndex)
    ? group.labels[group.keys.indexOf(key)] ?? null
    : null
})

/** 点字段定位：当前字段已在原图框出时的字段名 */
const activeLocated = computed(() => {
  const key = props.activeKey
  const group = key ? props.groups.find(candidate => candidate.keys.includes(key) && renderedPageIndexes.value.has(candidate.pageIndex)) : undefined
  return group && key ? group.labels[group.keys.indexOf(key)] ?? null : null
})

function percent(value: number) {
  return `${(value * 100).toFixed(3)}%`
}

function rotate(delta: 90 | -90) {
  rotation.value = ((rotation.value + delta + 360) % 360) as PreviewRotation
}

const { width: scrollerWidth } = useElementSize(scroller)
const reducedMotion = usePreferredReducedMotion()

/** 只滚动原图容器，不带动整页（避免把正在编辑的输入框滚走）。 */
async function revealActive() {
  await nextTick()
  const container = scroller.value
  const target = container?.querySelector<HTMLElement>('[data-active="true"]')
  if (!container || !target || !container.clientWidth)
    return
  const outer = container.getBoundingClientRect()
  const inner = target.getBoundingClientRect()
  container.scrollTo({
    top: container.scrollTop + inner.top - outer.top - Math.max(8, (outer.height - inner.height) / 2),
    left: container.scrollLeft + inner.left - outer.left - Math.max(8, (outer.width - inner.width) / 2),
    behavior: reducedMotion.value === 'reduce' ? 'auto' : 'smooth',
  })
}

// 强调目标、缩放、旋转或页面就绪变化时滚到目标；窄屏从隐藏面板切回（宽度由 0 变正）时补滚一次。
watch([toRef(props, 'activeKey'), zoom, rotation, pages], revealActive, { flush: 'post' })
watch(scrollerWidth, (width, previous) => {
  if (width > 0 && !previous)
    void revealActive()
})
</script>

<template>
  <section class="flex min-h-0 flex-col gap-2" data-testid="invoice-region-viewer" :aria-label="mode === 'compare' ? '发票原图识别变动比对' : '发票原图预览'">
    <div class="flex flex-wrap items-center gap-1.5">
      <template v-if="mode === 'compare'">
        <span class="i-lucide-scan-search text-13px text-warn-ink" aria-hidden="true" />
        <span class="text-12px font-700 text-ink">原图比对</span>
      </template>
      <span v-else-if="isPdf && pdfTotalPages" class="text-11px text-ink-soft">共 {{ pdfTotalPages }} 页</span>
      <span class="flex-1" />
      <div class="flex items-center gap-1" role="group" aria-label="原图缩放与旋转">
        <button type="button" class="icon-btn h-7 w-7" aria-label="缩小原图" title="缩小" :disabled="zoomIndex === 0" @click="zoomIndex--">
          <span class="i-lucide-zoom-out text-12px" aria-hidden="true" />
        </button>
        <button type="button" class="btn-ghost h-7 min-w-12 px-1.5 text-11px font-mono" aria-label="恢复 100% 缩放" title="恢复 100%" @click="zoomIndex = 2">
          {{ Math.round(zoom * 100) }}%
        </button>
        <button type="button" class="icon-btn h-7 w-7" aria-label="放大原图" title="放大" :disabled="zoomIndex === ZOOM_STEPS.length - 1" @click="zoomIndex++">
          <span class="i-lucide-zoom-in text-12px" aria-hidden="true" />
        </button>
        <button type="button" class="icon-btn h-7 w-7" aria-label="原图向左旋转" title="向左旋转" @click="rotate(-90)">
          <span class="i-lucide-rotate-ccw text-12px" aria-hidden="true" />
        </button>
        <button type="button" class="icon-btn h-7 w-7" aria-label="原图向右旋转" title="向右旋转" @click="rotate(90)">
          <span class="i-lucide-rotate-cw text-12px" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="mode" class="space-y-1 text-11px text-ink-soft" data-testid="invoice-region-legend">
      <template v-if="mode === 'compare'">
        <p v-if="locatedLabels.length">
          <span class="inline-block h-2.5 w-3.5 border-2 border-warn align-middle" aria-hidden="true" />
          已框出：{{ locatedLabels.join('、') }}（框住识别出该值的整块版面区域，非逐字定位）
        </p>
        <p v-if="unlocatedLabels.length" class="text-warn-ink">
          <span class="i-lucide-circle-help mr-0.5 align-middle text-11px" aria-hidden="true" />
          原图未定位：{{ unlocatedLabels.join('、') }}
        </p>
      </template>
      <template v-else>
        <p v-if="activeUnlocated" class="text-warn-ink">
          <span class="i-lucide-circle-help mr-0.5 align-middle text-11px" aria-hidden="true" />
          {{ activeUnlocated }}：原图未定位
        </p>
        <p v-else-if="activeLocated">
          <span class="i-lucide-crosshair mr-0.5 align-middle text-11px text-warn-ink" aria-hidden="true" />
          已定位：{{ activeLocated }}（框住识别出该值的整块版面区域，非逐字定位）
        </p>
        <p v-else>
          <span class="i-lucide-crosshair mr-0.5 align-middle text-11px" aria-hidden="true" />
          聚焦或悬停字段输入框，在原图上框出该字段所在区域
        </p>
      </template>
      <p class="sr-only" aria-live="polite">
        <template v-if="activeUnlocated">
          {{ activeUnlocated }}：原图未定位
        </template>
      </p>
    </div>

    <p v-if="hiddenPages" class="text-11px text-warn-ink" data-testid="invoice-preview-page-limit">
      <span class="i-lucide-files mr-0.5 align-middle text-11px" aria-hidden="true" />
      共 {{ hiddenPages.total }} 页，仅显示前 {{ hiddenPages.shown }} 页，第 {{ hiddenPages.shown + 1 }}–{{ hiddenPages.total }} 页未显示；需核对请用 PDF 阅读器打开原件
    </p>

    <div
      ref="scroller"
      class="relative min-h-0 flex-1 overflow-auto rounded-[var(--radius-sm)] bg-[#e8eaed] p-3"
      tabindex="0"
      aria-label="发票原图，可滚动查看"
    >
      <div v-if="isPdf && pdfState === 'loading'" class="py-10 text-center text-12px text-ink-faint">
        <span class="i-lucide-loader-circle mx-auto mb-2 block animate-spin text-18px" aria-hidden="true" />正在渲染 PDF…
      </div>
      <div v-else-if="failure" class="flex flex-col items-center gap-2 py-10 text-center text-12px text-warn-ink" role="alert">
        <span class="i-lucide-file-warning text-18px" aria-hidden="true" />
        <p>{{ failure }}，原文件未改动{{ mode ? '；原图未定位' : '' }}</p>
        <button ref="retryButton" type="button" class="btn-secondary" @click="reload">
          <span class="i-lucide-refresh-cw mr-1 text-12px" aria-hidden="true" />重新加载原图
        </button>
      </div>
      <div class="flex flex-col items-center gap-3">
        <div
          v-for="page in pages"
          :key="page.pageIndex"
          class="relative shrink-0 bg-white shadow-sm"
          :style="{ width: `${zoom * 100}%`, aspectRatio: String(page.frame.aspectRatio) }"
          :data-page-index="page.pageIndex"
        >
          <img
            :key="`${page.url}:${reloadToken}`"
            :src="page.url"
            :alt="pageCount > 1 ? `${file.name} 第 ${page.pageIndex + 1} 页` : file.name"
            class="absolute left-1/2 top-1/2 max-w-none select-none"
            :style="{ width: `${page.frame.imageWidth}%`, height: `${page.frame.imageHeight}%`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }"
            draggable="false"
            @load="onImageLoad(page, $event)"
            @error="onImageError(page)"
          >
          <span v-if="pageCount > 1" class="absolute right-1 top-1 rounded-[var(--radius-sm)] bg-ink px-1 text-10px text-white" aria-hidden="true">
            {{ page.pageIndex + 1 }} / {{ pageCount }}
          </span>
          <div aria-hidden="true">
            <div
              v-for="group in page.groups"
              :key="group.id"
              data-testid="invoice-region-box"
              :data-fields="group.keys.join(' ')"
              :data-active="group.active ? 'true' : 'false'"
              class="invoice-region-box pointer-events-none absolute rounded-[2px]"
              :class="{ 'invoice-region-box--active z-10': group.active }"
              :style="{ left: percent(group.box.x), top: percent(group.box.y), width: percent(group.box.width), height: percent(group.box.height) }"
            >
              <span
                class="absolute left-[-2px] inline-flex max-w-[min(100vw,24rem)] items-center gap-0.5 whitespace-nowrap rounded-[var(--radius-sm)] px-1 py-0.5 text-10px font-700 leading-none"
                :class="[group.labelInside ? 'top-0' : 'bottom-full mb-0.5', group.active ? 'bg-warn text-white' : 'border border-warn bg-warn-soft text-warn-ink']"
              >
                <span :class="group.active ? 'i-lucide-crosshair' : 'i-lucide-refresh-cw'" class="text-10px" />
                {{ group.labels.join('、') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 警示色框：平时虚线 + 浅底，强调时实线加粗 + 外圈，形态差异不只靠颜色；底色半透明，不遮住票面文字 */
.invoice-region-box {
  border: 2px dashed var(--warn);
  background: color-mix(in srgb, var(--warn) 6%, transparent);
  transition:
    background-color var(--dur-fast, 150ms),
    box-shadow var(--dur-fast, 150ms);
}

.invoice-region-box--active {
  border: 3px solid var(--warn);
  background: color-mix(in srgb, var(--warn) 16%, transparent);
  box-shadow:
    0 0 0 2px var(--panel),
    0 0 0 4px var(--warn);
}

@media (prefers-reduced-motion: reduce) {
  .invoice-region-box {
    transition: none;
  }
}
</style>
