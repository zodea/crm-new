<script setup lang="ts">
import type { SupplierContractRow } from '~/lib/material/price-analysis'

defineProps<{
  rows: readonly SupplierContractRow[]
}>()

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
</script>

<template>
  <section class="panel overflow-hidden" role="region" aria-label="相关厂家合作合同">
    <header class="section-heading justify-between">
      <div class="flex items-baseline gap-2">
        <h2 class="text-13px font-800 text-ink">
          相关厂家合作合同
        </h2>
        <span class="text-11px text-ink-soft">按所选材料出现的厂家汇总材采合同</span>
      </div>
      <span class="text-11px text-ink-faint">{{ rows.length }} 个厂家/项目组合</span>
    </header>

    <div v-if="rows.length" class="overflow-x-auto" tabindex="0" aria-label="厂家合作合同表">
      <table class="w-full min-w-[900px] border-collapse text-12px">
        <thead>
          <tr class="h-9 bg-surface-2 text-left text-ink-soft">
            <th class="px-3 font-700">
              厂家
            </th>
            <th class="px-3 font-700">
              合作项目
            </th>
            <th class="px-3 font-700">
              合同数 / 合同名称
            </th>
            <th class="px-3 text-right font-700">
              合同金额
            </th>
            <th class="px-3 font-700">
              签订日期
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" class="border-t border-line align-top">
            <td class="px-3 py-2.5 font-700 text-ink">
              {{ row.supplierName }}
            </td>
            <td class="px-3 py-2.5 text-ink">
              {{ row.projectName }}
            </td>
            <td class="px-3 py-2.5">
              <div class="mb-1 text-11px text-ink-soft">
                {{ row.contractCount }} 份合同
              </div>
              <div v-for="contract in row.contracts" :key="contract.id" class="leading-6">
                <NuxtLink :to="`/contract/${encodeURIComponent(contract.id)}${contract.dataOrigin ? `?contractKind=material&origin=${contract.dataOrigin}` : ''}`" class="text-brand hover:underline">
                  {{ contract.name }}
                </NuxtLink>
                <span class="ml-1 font-mono text-ink-faint">{{ contract.no }}</span>
              </div>
            </td>
            <td class="px-3 py-2.5 text-right font-mono font-700 text-ink">
              {{ money(row.totalAmount) }}
            </td>
            <td class="px-3 py-2.5 text-ink-soft">
              <div v-for="contract in row.contracts" :key="contract.id" class="leading-6">
                {{ contract.signDate || '—' }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else role="status" class="px-4 py-8 text-center text-12px text-ink-soft">
      当前材料涉及的厂家尚无材料采购合同
    </div>
  </section>
</template>
