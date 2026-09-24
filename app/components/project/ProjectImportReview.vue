<script setup lang="ts">
import type { ImportPreviewEntry } from '~/components/import/ImportPreviewStep.vue'
import type { ProjectFormDraft } from '~/lib/master-data/forms'
import { projectImportSource } from '~/lib/project/import'

defineProps<{
  entries: readonly ImportPreviewEntry[]
  reviewed: Record<number, { draft?: ProjectFormDraft, error?: string }>
}>()
</script>

<template>
  <section class="mb-4 min-w-0" aria-label="项目导入核对结果">
    <p class="mb-2 text-12px text-ink-soft">
      核对真实客户 ID 与采用阶段；未通过的行会单独列出，其余行继续导入。
    </p>
    <div class="max-h-72 overflow-auto border border-line rounded bg-panel" tabindex="0" role="region" aria-label="客户身份与阶段核对表">
      <table class="w-full whitespace-nowrap text-left text-12px">
        <thead class="sticky top-0 bg-surface-2">
          <tr>
            <th class="p-2">
              原始行
            </th><th class="p-2">
              项目
            </th><th class="p-2">
              客户 ID
            </th><th class="p-2">
              次客户 ID
            </th><th class="p-2">
              原始阶段 → 采用阶段
            </th><th class="p-2">
              结果
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.index" class="border-t border-line">
            <td class="p-2">
              {{ projectImportSource(entry.row)?.rowNumber }}
            </td>
            <td class="p-2">
              {{ entry.row.name || '—' }}
            </td>
            <td class="p-2">
              {{ reviewed[entry.index]?.draft?.customerId || '—' }}
            </td>
            <td class="p-2">
              {{ reviewed[entry.index]?.draft?.secondaryCustomerId || '—' }}
            </td>
            <td class="p-2">
              {{ entry.row.status || '空' }} → {{ reviewed[entry.index]?.draft?.status || '—' }}
            </td>
            <td class="p-2" :class="reviewed[entry.index]?.error ? 'text-danger-ink' : 'text-ok-ink'">
              {{ reviewed[entry.index]?.error || '可导入' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
