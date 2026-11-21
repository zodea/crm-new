<script setup lang="ts">
import type { OwnerCommercialDocumentDetailReadDTO } from '~/lib/owner-document/central-repository'
import { yuan } from '~/lib/util/money'

defineProps<{ detail: OwnerCommercialDocumentDetailReadDTO, returnTo: string }>()
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="penalty-deduction-title">
    <h3 id="penalty-deduction-title" class="mb-3 text-14px font-700">
      结算抵扣记录
    </h3>
    <div class="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand" tabindex="0" aria-label="抵扣记录滚动区域" data-testid="penalty-history-scroll">
      <table class="w-full min-w-640px text-left text-13px" aria-label="抵扣历史">
        <thead class="bg-surface-2 text-ink-soft">
          <tr>
            <th>真实结算</th><th class="text-right">
              本次抵扣
            </th><th>经办人</th><th>发生时间</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in detail.penaltyDeductions" :key="row.id" class="border-b border-line">
            <td><EntityLink type="subcontract-document" :intent="row.navigation" :label="row.settlementName" :return-to="returnTo" /></td>
            <td class="text-right font-mono">
              {{ yuan(Number(row.amount)) }}
            </td>
            <td>{{ row.actorId || '历史未记录' }}</td><td class="font-mono">
              {{ row.occurredAt.replace('T', ' ').slice(0, 19) }}
            </td><td>{{ row.note || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!detail.penaltyDeductions?.length" class="py-6 text-center text-13px text-ink-soft">
      暂无结算抵扣记录
    </p>
  </section>
  <section class="panel p-4" data-testid="penalty-rectification-history">
    <h3 class="mb-3 text-14px font-700">
      整改历史
    </h3>
    <ol v-if="detail.penaltyRectifications?.length" class="space-y-3">
      <li v-for="row in detail.penaltyRectifications" :key="row.id" class="border-b border-line pb-3 text-13px">
        <p class="whitespace-pre-wrap break-words">
          {{ row.note }}
        </p>
        <p class="mt-2 text-12px text-ink-soft">
          {{ row.actorId || '历史未记录' }} · {{ row.occurredAt.replace('T', ' ').slice(0, 19) }} · 期限 {{ row.deadline || '未记录' }}
        </p>
      </li>
    </ol>
    <p v-else class="text-13px text-ink-soft">
      暂无追加整改记录
    </p>
  </section>
</template>

<style scoped>
th, td { padding: 12px 14px; vertical-align: top; }
td { overflow-wrap: anywhere; }
</style>
