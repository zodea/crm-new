<script setup lang="ts">
import type { InvoiceRecognitionChange } from '~/lib/invoice/recognition-changes'

// 重新识别草稿提醒：识别结果只在当前表单中，保存（二次确认）前不写库；放弃则恢复识别前的值。
defineProps<{
  changes: readonly InvoiceRecognitionChange[]
  /** 提供时在提醒内显示保存按钮（工作台没有独立保存按钮）；整页编辑沿用页面的保存。 */
  saveLabel?: string
  /** 原图比对可用时传入定位不到的字段 key；条目可聚焦/悬停以在原图上强调对应区域 */
  unlocatedKeys?: readonly string[]
}>()

const emit = defineEmits<{
  discard: []
  save: []
  /** 聚焦或点击条目：原图强调该字段并保持 */
  locate: [key: string]
  /** 悬停条目：临时强调，离开为 null */
  preview: [key: string | null]
}>()
</script>

<template>
  <div
    data-testid="invoice-recognition-changes"
    role="status"
    class="border border-warn/35 rounded-[var(--radius-btn)] bg-warn-soft p-3 text-12px text-warn-ink"
  >
    <p class="flex items-start gap-1.5 font-700">
      <span class="i-lucide-refresh-cw mt-0.5 shrink-0 text-12px" aria-hidden="true" />
      <span v-if="changes.length">重新识别结果未保存：{{ changes.length }} 项与识别前不同，已在字段上标出，请逐项核对后保存</span>
      <span v-else>重新识别结果未保存：票面字段与识别前一致，保存后回到待校对</span>
    </p>
    <ul v-if="changes.length" class="mt-1.5 space-y-1">
      <li v-for="change in changes" :key="change.key" class="break-all">
        <button
          v-if="unlocatedKeys"
          type="button"
          class="w-full cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent px-1 py-0.5 text-left text-inherit hover:bg-panel focus-visible:bg-panel"
          :title="unlocatedKeys.includes(change.key) ? '原图未定位' : '在原图上定位'"
          data-testid="invoice-recognition-change-item"
          @focus="emit('locate', change.key)"
          @click="emit('locate', change.key)"
          @mouseenter="emit('preview', change.key)"
          @mouseleave="emit('preview', null)"
        >
          <span class="font-600">{{ change.label }}</span>：<span class="line-through opacity-75">{{ change.before || '（空）' }}</span>
          → <span class="font-600">{{ change.after || '（空）' }}</span>
          <span v-if="unlocatedKeys.includes(change.key)" class="ml-1 whitespace-nowrap rounded-[var(--radius-sm)] border border-warn/50 px-1 text-10px font-600">原图未定位</span>
          <template v-else>
            <span class="i-lucide-crosshair ml-1 align-middle text-11px" aria-hidden="true" /><span class="sr-only">，原图已框出</span>
          </template>
        </button>
        <template v-else>
          <span class="font-600">{{ change.label }}</span>：<span class="line-through opacity-75">{{ change.before || '（空）' }}</span>
          → <span class="font-600">{{ change.after || '（空）' }}</span>
        </template>
      </li>
    </ul>
    <div class="mt-2 flex flex-wrap justify-end gap-2">
      <button type="button" class="btn-ghost h-7 px-2 text-12px" @click="emit('discard')">
        放弃识别结果
      </button>
      <button v-if="saveLabel" type="button" class="btn-accent h-7 px-2 text-12px" @click="emit('save')">
        {{ saveLabel }}
      </button>
    </div>
  </div>
</template>
