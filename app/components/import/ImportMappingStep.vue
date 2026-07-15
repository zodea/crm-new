<script setup lang="ts">
import type {
  ImportFieldStatus,
  ImportMapping,
  ImportTemplateField,
} from '~/lib/kit/import-mapping'
import { computed } from 'vue'

const props = defineProps<{
  fields: readonly ImportTemplateField[]
  columns: readonly string[]
  mapping: ImportMapping
  status: Record<string, ImportFieldStatus>
}>()

const emit = defineEmits<{
  select: [fieldKey: string, column: string | null]
  confirm: [fieldKey: string]
}>()

interface StatusPresentation {
  label: string
  chip: string
}

// 三色态（ADR 0005）：--brand 已匹配 / --warn 待确认 / --danger 必填缺失；未映射为中性。
const STATUS_PRESENTATION: Readonly<Record<ImportFieldStatus, StatusPresentation>> = {
  'matched': { label: '已匹配', chip: 'bg-brand-soft text-brand-deep' },
  'pending': { label: '待确认', chip: 'bg-warn-soft text-warn-ink' },
  'required-missing': { label: '必填缺失', chip: 'bg-danger-soft text-danger-ink' },
  'unmapped': { label: '未映射', chip: 'bg-surface-3 text-ink-faint' },
}

const unusedColumns = computed(() => {
  const used = new Set(Object.values(props.mapping).map(match => match.column))
  return props.columns.filter(column => !used.has(column))
})

// 手动映射允许同列供多个字段使用（如名称与匹配标识同列），但需显式提示避免误映。
const duplicatedColumns = computed(() => {
  const counts = new Map<string, number>()
  for (const match of Object.values(props.mapping))
    counts.set(match.column, (counts.get(match.column) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([column]) => column)
})

function onSelect(fieldKey: string, event: Event) {
  const value = (event.currentTarget as HTMLSelectElement).value
  emit('select', fieldKey, value || null)
}
</script>

<template>
  <section aria-label="源列映射到模板字段">
    <div class="border border-line rounded-[var(--radius-card)] bg-panel">
      <div
        class="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-3 border-b border-line px-4 py-2 text-11px text-ink-faint font-700 tracking-wide uppercase"
        aria-hidden="true"
      >
        <span>系统模板字段</span>
        <span>源列</span>
        <span>状态</span>
        <span />
      </div>

      <ul class="m-0 list-none p-0">
        <li
          v-for="field in fields"
          :key="field.key"
          class="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
          :data-field="field.key"
          :data-status="status[field.key]"
        >
          <span class="min-w-0 truncate text-13px text-ink">
            {{ field.label }}
            <span v-if="field.required" class="text-danger" aria-label="必填">*</span>
          </span>

          <select
            :value="mapping[field.key]?.column ?? ''"
            class="field-input w-full"
            :aria-label="`${field.label}的源列`"
            @change="onSelect(field.key, $event)"
          >
            <option value="">
              不导入此字段
            </option>
            <option v-for="column in columns" :key="column" :value="column">
              {{ column }}
            </option>
          </select>

          <span
            class="rounded-full px-2 py-0.5 text-11px font-600"
            :class="STATUS_PRESENTATION[status[field.key] ?? 'unmapped'].chip"
          >
            {{ STATUS_PRESENTATION[status[field.key] ?? 'unmapped'].label }}
          </span>

          <button
            v-if="status[field.key] === 'pending'"
            type="button"
            class="border border-warn/50 rounded-[var(--radius-btn)] bg-transparent px-2 py-1 text-11px text-warn-ink font-600 hover:bg-warn-soft"
            :aria-label="`确认${field.label}的匹配`"
            @click="emit('confirm', field.key)"
          >
            确认
          </button>
          <span v-else />
        </li>
      </ul>
    </div>

    <p v-if="duplicatedColumns.length" class="mt-3 text-11px text-warn-ink font-600">
      同一源列被多个字段使用：{{ duplicatedColumns.join('、') }}，请确认是否有意。
    </p>

    <p v-if="unusedColumns.length" class="mt-3 text-11px text-ink-faint">
      未使用的源列：
      <span
        v-for="column in unusedColumns"
        :key="column"
        class="mx-0.5 inline-block rounded-full bg-surface-3 px-2 py-0.5"
      >{{ column }}</span>
    </p>
  </section>
</template>
