<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import { computed } from 'vue'
import { dayworkStatusLabel, dayworkStatusTone, payrollAmount } from '~/lib/payroll/read-presentation'

export interface PayrollEvidenceColumn { field: string, title: string, width?: number, money?: boolean }
const props = defineProps<{ title: string, rows: readonly object[], columns: readonly PayrollEvidenceColumn[], empty?: string }>()
const columns = computed<KitTableColumn[]>(() => props.columns.map(column => ({ field: column.field, title: column.title, minWidth: column.width || 130, align: column.money ? 'right' : 'left', ...(column.field === 'status' ? { slot: 'status' } : {}) })))
const rows = computed(() => props.rows.map((row, index) => {
  const values = Object.fromEntries(Object.entries(row))
  return Object.fromEntries([['key', values.id || `history-${index}`], ['sourceStatus', String(values.status ?? '')], ...props.columns.map((column) => {
    const value = values[column.field]
    const text = column.field === 'deletedAt' ? value ? '已删除' : '保留中' : column.field === 'isLeader' ? value ? '负责人' : '成员' : column.field === 'enabled' ? value === null ? '未记录' : value ? '启用' : '停用' : value == null || value === '' ? '未记录' : column.money && typeof value === 'number' ? payrollAmount(value) : column.field === 'status' ? dayworkStatusLabel(String(value)) : String(value)
    return [column.field, text]
  })])
}))
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" :aria-label="title">
    <SectionHeader :title="title" />
    <KitTable :columns="columns" :data="rows" row-key="key" :min-rows="3" :row-height="48" :empty="empty || '原资料未提供对应记录'">
      <template #status="{ row }">
        <KitStatusTag :tone="dayworkStatusTone(row.sourceStatus)">
          {{ row.status }}
        </KitStatusTag>
      </template>
    </KitTable>
    <details v-if="rows.length" class="min-w-0 border-t border-line p-3 text-12px">
      <summary class="cursor-pointer">
        查看完整记录内容
      </summary><ol class="mt-3 grid gap-3">
        <li v-for="row in rows" :key="row.key" class="grid min-w-0 gap-2 border-t border-line pt-3">
          <dl class="grid gap-2 sm:grid-cols-2">
            <div v-for="column in columns" :key="column.field" class="min-w-0">
              <dt class="text-ink-faint">
                {{ column.title }}
              </dt><dd class="mt-1 whitespace-pre-wrap break-words leading-5">
                {{ row[column.field!] }}
              </dd>
            </div>
          </dl>
        </li>
      </ol>
    </details>
  </section>
</template>
