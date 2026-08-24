<script setup lang="ts">
import type { MaterialContractFactDTO } from '~/lib/material-contract/repository'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { yuan } from '~/lib/util/money'

defineProps<{
  rows: readonly MaterialContractFactDTO[]
  emptyLabel: string
  paidColumn?: boolean
}>()

function target(row: MaterialContractFactDTO) {
  const result = resolveNavigationTarget(row.navigation)
  return result.state === 'resolved' ? result.to : null
}
</script>

<template>
  <div class="material-fact-scroll" data-testid="material-contract-fact-scroll">
    <table v-if="rows.length" class="material-fact-table">
      <thead>
        <tr>
          <th>单号</th><th>名称</th><th>日期</th><th class="text-right">
            金额
          </th>
          <th v-if="paidColumn" class="text-right">
            已支付
          </th><th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono">
            {{ row.no || '—' }}
          </td>
          <td>
            <NuxtLink v-if="target(row)" :to="target(row)!" class="font-700 text-brand hover:underline">
              {{ row.name || row.no || '查看来源' }}
            </NuxtLink>
            <span v-else>{{ row.name || '—' }}</span>
          </td>
          <td class="font-mono">
            {{ row.date || '—' }}
          </td>
          <td class="text-right font-mono">
            {{ row.amount == null ? '—' : yuan(Number(row.amount)) }}
          </td>
          <td v-if="paidColumn" class="text-right font-mono">
            {{ yuan(Number(row.paidAmount ?? 0)) }}
          </td>
          <td><span class="chip bg-surface-3 text-ink-soft">{{ row.status || '未记录' }}</span></td>
        </tr>
      </tbody>
    </table>
    <div v-else class="p-8 text-center text-13px text-ink-soft" data-testid="material-contract-empty">
      {{ emptyLabel }}
    </div>
  </div>
</template>

<style scoped>
.material-fact-scroll { min-width: 0; overflow-x: auto; }
.material-fact-table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 12px; }
.material-fact-table th { padding: 9px 10px; text-align: left; color: var(--ink-soft); background: var(--surface-2); white-space: nowrap; }
.material-fact-table td { padding: 10px; border-top: 1px solid var(--line); }
</style>
