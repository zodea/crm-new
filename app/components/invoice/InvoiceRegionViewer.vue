<script setup lang="ts">
import type { PdfPreviewPage } from '~/lib/invoice/pdf-preview'
import type { InvoiceRecognitionField } from '~/lib/invoice/recognition-changes'
import type { InvoiceRegionHighlightGroup, PreviewRotation } from '~/lib/invoice/recognition-regions'
import { useElementSize, useObjectUrl, usePreferredReducedMotion } from '@vueuse/core'
import { computed, nextTick, onScopeDispose, shallowRef, toRef, useTemplateRef, watch } from 'vue'
import { renderPdfPreviewPages } from '~/lib/invoice/pdf-preview'
import { rotatedFrame, rotateNormalizedBox } from '~/lib/invoice/recognition-regions'

// 重新识别草稿的原图比对：在原文件上用警示框标出识别变动字段所在的版面块（块级，不是字段级），
// 框带字段名标签；activeKey 对应的框强调并滚进视野。缩放、旋转、页码都由同一份 0~1 坐标换算，框随之同步。
const props = defineProps<{
  file: File
  groups: readonly InvoiceRegionHighlightGroup[]
  unlocated: readonly InvoiceRecognitionField[]
  activeKey?: string | null
}>()

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const
const zoomIndex = shallowRef(2)
const zoom = computed(() => ZOOM_STEPS[zoomIndex.value]!)
const rotation = shallowRef<PreviewRotation>(0)

const isPdf = computed(() => props.file.type === 'application/pdf' || /\.pdf$/i.test(props.file.name))
const imageUrl = useObjectUrl(computed(() => isPdf.value ? undefined : props.file))
const imageSize = shallowRef<{ width: number, height: number } | null>(null)
const pdfPages = shallowRef<PdfPreviewPage[]>([])
const pdfState = shallowRef<'idle' | 'loading' | 'failed'>('idle')

function revokePdfPages() {
  pdfPages.value.forEach(page => URL.revokeObjectURL(page.url))
  pdfPages.value = []
}

watch(() => props.file, async (file, _, onCleanup) => {
  let cancelled = false
  onCleanup(() => {
    cancelled = true
  })
  revokePdfPages()
  imageSize.value = null
  rotation.value = 0
  if (!isPdf.value)
    return
  pdfState.value = 'loading'
  try {
    const pages = await renderPdfPreviewPages(file)
    if (cancelled) {
      pages.forEach(page => URL.revokeObjectURL(page.url))
      return
    }
    pdfPages.value = pages
    pdfState.value = pages.length ? 'idle' : 'failed'
  }
  catch {
    if (!cancelled)
      pdfState.value = 'failed'
  }
}, { immediate: true })
onScopeDispose(revokePdfPages)

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement
  if (image.naturalWidth && image.naturalHeight)
    imageSize.value = { width: image.naturalWidth, height: image.naturalHeight }
}

/** 未取到原始尺寸前按 A4 竖版比例占位，框仍按百分比定位。 */
const A4 = { width: 1, height: Math.SQRT2 }
const pages = computed(() => {
  const list = isPdf.value
    ? pdfPages.value.map(page => ({ pageIndex: page.pageIndex, url: page.url, size: { width: page.width, height: page.height }, natural: true }))
    : imageUrl.value ? [{ pageIndex: 0, url: imageUrl.value, size: imageSize.value ?? A4, natural: !!imageSize.value }] : []
  return list.map(page => ({
    ...page,
    frame: rotatedFrame(page.size, rotation.value),
    groups: props.groups
      .filter(group => group.pageIndex === page.pageIndex)
      .map((group) => {
        const box = rotateNormalizedBox(group.box, rotation.value)
        // 贴近页顶的框把字段名标签放进框内，避免伸出页面被遮住
        return { ...group, box, labelInside: box.y < 0.05, active: !!props.activeKey && group.keys.includes(props.activeKey) }
      }),
  }))
})
const pageCount = computed(() => pages.value.length)

/** 框所在页超出已渲染页数（PDF 只渲染前若干页）时归入未定位，不悬空。 */
const renderedPageIndexes = computed(() => new Set(pages.value.map(page => page.pageIndex)))
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

function percent(value: number) {
  return `${(value * 100).toFixed(3)}%`
}

function rotate(delta: 90 | -90) {
  rotation.value = ((rotation.value + delta + 360) % 360) as PreviewRotation
}

const scroller = useTemplateRef<HTMLElement>('scroller')
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
  <section class="flex min-h-0 flex-col gap-2" data-testid="invoice-region-viewer" aria-label="发票原图识别变动比对">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="i-lucide-scan-search text-13px text-warn-ink" aria-hidden="true" />
      <span class="text-12px font-700 text-ink">原图比对</span>
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

    <div class="space-y-1 text-11px text-ink-soft" data-testid="invoice-region-legend">
      <p v-if="locatedLabels.length">
        <span class="inline-block h-2.5 w-3.5 border-2 border-warn align-middle" aria-hidden="true" />
        已框出：{{ locatedLabels.join('、') }}（框住识别出该值的整块版面区域，非逐字定位）
      </p>
      <p v-if="unlocatedLabels.length" class="text-warn-ink">
        <span class="i-lucide-circle-help mr-0.5 align-middle text-11px" aria-hidden="true" />
        原图未定位：{{ unlocatedLabels.join('、') }}
      </p>
      <p class="sr-only" aria-live="polite">
        <template v-if="activeUnlocated">
          {{ activeUnlocated }}：原图未定位
        </template>
      </p>
    </div>

    <div
      ref="scroller"
      class="relative min-h-0 flex-1 overflow-auto rounded-[var(--radius-sm)] bg-[#e8eaed] p-3"
      tabindex="0"
      aria-label="发票原图，可滚动查看"
    >
      <div v-if="isPdf && pdfState === 'loading'" class="py-10 text-center text-12px text-ink-faint">
        <span class="i-lucide-loader-circle mx-auto mb-2 block animate-spin text-18px" aria-hidden="true" />正在渲染 PDF…
      </div>
      <div v-else-if="isPdf && pdfState === 'failed'" class="py-10 text-center text-12px text-warn-ink">
        PDF 无法在此渲染，原图未定位
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
            :src="page.url"
            :alt="pageCount > 1 ? `${file.name} 第 ${page.pageIndex + 1} 页` : file.name"
            class="absolute left-1/2 top-1/2 max-w-none select-none"
            :style="{ width: `${page.frame.imageWidth}%`, height: `${page.frame.imageHeight}%`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }"
            draggable="false"
            @load="onImageLoad"
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
