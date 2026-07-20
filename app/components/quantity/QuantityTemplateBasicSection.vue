<script setup lang="ts">
import type { QuantityTemplateSummary } from '~/lib/quantity/template'

const props = defineProps<{
  templates: readonly QuantityTemplateSummary[]
  selectedTemplateId: string
  selectedTemplate: QuantityTemplateSummary | null
  copiedFromTemplateId: string | null
  dirty: boolean
}>()

const emit = defineEmits<{
  templateChange: [event: Event]
  createBlank: []
  borrowCurrent: []
}>()

const code = defineModel<string>('code', { required: true })
const name = defineModel<string>('name', { required: true })
</script>

<template>
  <section id="form-section-basic" class="scroll-mt-4">
    <div class="mb-3 flex flex-wrap items-end gap-3 rounded-[var(--radius-btn)] border border-line bg-surface-2 p-3">
      <label class="min-w-52 flex-1">
        <span class="field-label">当前模板</span>
        <select
          :value="props.selectedTemplateId"
          class="field-input w-full"
          aria-label="当前户型模板"
          @change="emit('templateChange', $event)"
        >
          <option value="">新建草稿</option>
          <option v-for="template in props.templates" :key="template.id" :value="template.id">
            {{ template.code }} · {{ template.name }} · {{ template.unitCount }} 户
          </option>
        </select>
      </label>
      <button type="button" class="btn-secondary" @click="emit('createBlank')">
        <span class="i-lucide-plus mr-1" aria-hidden="true" />新建空白
      </button>
      <button type="button" class="btn-secondary" :disabled="!props.selectedTemplateId" @click="emit('borrowCurrent')">
        <span class="i-lucide-copy mr-1" aria-hidden="true" />借用当前模板新建
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label>
        <span class="field-label">户型编码 *</span>
        <input v-model="code" class="field-input w-full" placeholder="如 A / B / C" autocomplete="off">
      </label>
      <label>
        <span class="field-label">户型名称 *</span>
        <input v-model="name" class="field-input w-full" placeholder="如 A户型" autocomplete="off">
      </label>
    </div>
    <div class="mt-2 flex flex-wrap items-center gap-2 text-11px text-ink-soft">
      <span v-if="props.selectedTemplate" class="chip-brand">活链接 {{ props.selectedTemplate.unitCount }} 户</span>
      <span v-if="props.copiedFromTemplateId" class="chip">一次性借用快照</span>
      <span v-if="props.dirty" class="status-warn">有未保存修改</span>
      <span v-else class="status-ok">已同步正式版本</span>
    </div>
  </section>
</template>
