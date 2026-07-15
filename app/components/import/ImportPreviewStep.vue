<script setup lang="ts">
import type { ImportTemplateField } from '~/lib/kit/import-mapping'
import { computed } from 'vue'

export interface ImportPreviewEntry {
  /** 源数据中的原始行号（删除按它记账，不随过滤位移）。 */
  index: number
  row: Record<string, unknown>
}

const props = defineProps<{
  fields: readonly ImportTemplateField[]
  entries: readonly ImportPreviewEntry[]
  removedCount: number
  /** 导入开始后锁定删行。 */
  locked: boolean
}>()

const emit = defineEmits<{
  remove: [index: number]
}>()

// 迁移文件可达数千行，整表渲染会拖垮 DOM；预览只展示前 200 行，
// 导入仍按全部保留行执行（删行操作也只面向可见部分——异实体行通常在表头附近）。
const PREVIEW_LIMIT = 200
const visibleEntries = computed(() => props.entries.slice(0, PREVIEW_LIMIT))
const hiddenCount = computed(() => Math.max(0, props.entries.length - PREVIEW_LIMIT))

function cellText(value: unknown): string {
  return value == null || value === '' ? '—' : String(value)
}
</script>

<template>
  <section aria-label="导入行预览">
    <p class="mb-2 text-11px text-ink-faint">
      {{ removedCount
        ? `共 ${entries.length} 行待导入，已删除 ${removedCount} 行`
        : `共 ${entries.length} 行待导入` }}；不属于该实体的行可在此删除。<template v-if="hiddenCount">
        仅预览前 {{ PREVIEW_LIMIT }} 行，其余 {{ hiddenCount }} 行同样会导入。
      </template>
    </p>

    <div class="overflow-x-auto border border-line rounded-[var(--radius-card)] bg-panel">
      <table class="w-full border-collapse text-12px">
        <thead>
          <tr class="border-b border-line text-left text-11px text-ink-faint">
            <th class="px-3 py-2 font-700">
              #
            </th>
            <th v-for="field in fields" :key="field.key" class="px-3 py-2 font-700">
              {{ field.label }}
            </th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(entry, order) in visibleEntries"
            :key="entry.index"
            class="border-b border-line last:border-b-0"
          >
            <td class="px-3 py-2 text-ink-faint font-mono tabular-nums">
              {{ order + 1 }}
            </td>
            <td
              v-for="field in fields"
              :key="field.key"
              class="max-w-[180px] truncate px-3 py-2 text-ink"
            >
              {{ cellText(entry.row[field.key]) }}
            </td>
            <td class="px-3 py-2 text-right">
              <button
                type="button"
                class="border border-transparent rounded-[var(--radius-btn)] bg-transparent px-2 py-1 text-11px text-danger font-600 disabled:cursor-not-allowed hover:bg-danger-soft disabled:opacity-40"
                :disabled="locked"
                :aria-label="`删除第 ${order + 1} 行`"
                @click="emit('remove', entry.index)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="!entries.length" class="px-3 py-6 text-center text-12px text-ink-faint">
        没有待导入的行（可能已全部删除），请返回上一步调整。
      </p>
    </div>
  </section>
</template>
