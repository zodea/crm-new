<script setup lang="ts">
import type { NavigationIntentDTO } from '~/types/read-model'
import ProjectSupplierSourceLink from '~/components/project-supplier/ProjectSupplierSourceLink.vue'

interface ProjectSupplierFactTableRow {
  id: string
  navigation: NavigationIntentDTO
  cells: Array<{
    text: string
    tone?: 'default' | 'money' | 'muted' | 'status'
  }>
}

defineProps<{
  columns: readonly string[]
  rows: readonly ProjectSupplierFactTableRow[]
  empty: string
  returnTo: string
  unverifiedLabel?: string
}>()
</script>

<template>
  <div class="min-w-0 overflow-x-auto" tabindex="0" aria-label="业务记录表格，可横向滚动">
    <table class="w-full min-w-[64rem] border-collapse text-left text-11px">
      <thead>
        <tr class="border-b border-line bg-surface-2 text-ink-soft">
          <th v-for="column in columns" :key="column" scope="col" class="whitespace-nowrap px-3 py-2 font-600">
            {{ column }}
          </th>
          <th scope="col" class="w-20 whitespace-nowrap px-3 py-2 font-600">
            来源
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length + 1" class="px-4 py-9 text-center text-12px text-ink-faint">
            {{ empty }}
          </td>
        </tr>
        <tr v-for="row in rows" v-else :key="row.id" class="border-b border-line last:border-b-0 hover:bg-surface-2">
          <td
            v-for="(cell, index) in row.cells"
            :key="`${row.id}-${index}`"
            class="max-w-72 px-3 py-2.5"
            :class="{
              'font-mono tabular-nums text-right text-ink': cell.tone === 'money',
              'text-ink-faint': cell.tone === 'muted',
              'font-600 text-ink': cell.tone === 'default' || !cell.tone,
            }"
          >
            <span
              v-if="cell.tone === 'status'"
              class="chip"
              :class="['approved', 'confirmed', '已审批', '已确认', 'archived'].includes(cell.text)
                ? 'chip-ok'
                : cell.text === 'draft' || cell.text === '草稿'
                  ? 'bg-surface-3 text-ink-faint'
                  : 'chip-brand'"
            >
              {{ cell.text || '未记录' }}
            </span>
            <span v-else class="break-words">{{ cell.text || '—' }}</span>
          </td>
          <td class="whitespace-nowrap px-3 py-2.5">
            <ProjectSupplierSourceLink label="查看源单" :intent="row.navigation" :return-to="returnTo" :unverified-label="unverifiedLabel" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
