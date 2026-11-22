<script setup lang="ts">
import type { QuantityTemplateRoomDraft } from '~/lib/quantity/template'

const props = defineProps<{
  rooms: readonly QuantityTemplateRoomDraft[]
}>()

const emit = defineEmits<{
  add: []
  remove: [room: QuantityTemplateRoomDraft]
  updateRoom: [payload: { key: string, field: 'code' | 'name', value: string }]
}>()

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <section id="section-rooms" class="mt-6 scroll-mt-4 border-t border-line pt-5">
    <div class="mb-2 flex items-center gap-2">
      <div>
        <h3 class="text-13px font-800 text-ink">
          稳定房间身份
        </h3>
        <p class="mt-0.5 text-11px text-ink-soft">
          编码与 ID 创建后保持稳定；显示名称可改，整户范围不能删除。
        </p>
      </div>
      <button type="button" class="btn-secondary ml-auto" @click="emit('add')">
        <span class="i-lucide-plus mr-1" aria-hidden="true" />添加房间
      </button>
    </div>
    <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="room in props.rooms"
        :key="room.key"
        class="rounded-[var(--radius-btn)] border border-line bg-surface-2 p-3"
      >
        <div class="mb-2 flex items-center gap-2">
          <span :class="room.kind === 'whole_unit' ? 'chip-brand' : 'chip'">
            {{ room.kind === 'whole_unit' ? '系统范围' : '普通房间' }}
          </span>
          <button
            v-if="room.kind === 'room'"
            type="button"
            class="icon-btn-danger ml-auto h-7 w-7"
            :aria-label="`删除房间 ${room.name}`"
            @click="emit('remove', room)"
          >
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </div>
        <label class="block">
          <span class="field-label">房间编码</span>
          <input
            :value="room.code"
            class="field-input w-full"
            :readonly="Boolean(room.id) || room.kind === 'whole_unit'"
            @input="emit('updateRoom', { key: room.key, field: 'code', value: inputValue($event) })"
          >
        </label>
        <label class="mt-2 block">
          <span class="field-label">显示名称</span>
          <input
            :value="room.name"
            class="field-input w-full"
            :readonly="room.kind === 'whole_unit'"
            @input="emit('updateRoom', { key: room.key, field: 'name', value: inputValue($event) })"
          >
        </label>
      </div>
    </div>
  </section>
</template>
