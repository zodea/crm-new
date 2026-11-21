<script setup lang="ts">
import type { DeliveryFile } from '~/stores/delivery'

const props = defineProps<{
  file?: DeliveryFile
  previewUrl?: string
}>()

const rotation = shallowRef(0)
const imageStyle = computed(() => ({ transform: `rotate(${rotation.value}deg)` }))

watch(() => props.file?.id, () => {
  rotation.value = 0
})

function rotate(delta: number) {
  rotation.value = (rotation.value + delta + 360) % 360
}
</script>

<template>
  <section class="panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3">
      <div class="min-w-0">
        <div class="truncate text-11px font-700 text-ink" :title="file?.name">
          {{ file?.name || '原始单据' }}
        </div>
        <div v-if="file?.model" class="text-9px text-ink-faint">
          {{ file.model }} · {{ file.preprocessed ? '本地裁边扶正后识别' : '云端方向校正/文档矫正' }}
        </div>
      </div>
      <div class="flex-1" />
      <template v-if="file?.kind === 'image' && previewUrl">
        <button type="button" class="icon-btn h-7 w-7" title="向左旋转预览" @click="rotate(-90)">
          <span class="i-lucide-rotate-ccw text-12px" />
        </button>
        <button type="button" class="icon-btn h-7 w-7" title="向右旋转预览" @click="rotate(90)">
          <span class="i-lucide-rotate-cw text-12px" />
        </button>
      </template>
    </div>

    <div class="relative min-h-0 flex-1 overflow-auto bg-[#e8eaed] p-3">
      <template v-if="previewUrl && file">
        <iframe
          v-if="file.kind === 'pdf'"
          :src="previewUrl"
          :title="`${file.name} 原始 PDF`"
          class="h-full min-h-120 w-full border-0 bg-white shadow-sm"
        />
        <div v-else class="flex min-h-full items-center justify-center">
          <img
            :src="previewUrl"
            :alt="`${file.name} 原始图片`"
            class="max-h-full max-w-full origin-center bg-white object-contain shadow-sm transition-transform duration-200"
            :style="imageStyle"
          >
        </div>
      </template>
      <div v-else class="flex h-full min-h-80 flex-col items-center justify-center text-center text-ink-faint">
        <span class="i-lucide-image-off mb-2 text-26px" />
        <p class="text-11px">
          选择上传文件后在此核对原图
        </p>
      </div>
    </div>
  </section>
</template>
