<script setup lang="ts">
import type { OwnerCommercialDocumentDetailReadDTO } from '~/lib/owner-document/central-repository'
import type { ProblemDTO } from '~/types/read-model'
import ReceiptSourceLink from '~/components/receipt/ReceiptSourceLink.vue'
import { yuan } from '~/lib/util/money'

type SettlementSources = NonNullable<OwnerCommercialDocumentDetailReadDTO['finalSettlementEvidence']>['sources']
type SettlementSource = NonNullable<SettlementSources>[number]

defineProps<{
  sources: SettlementSources
  returnTo: string
  receiptsProblem?: ProblemDTO
  sourceStates?: NonNullable<OwnerCommercialDocumentDetailReadDTO['finalSettlementEvidence']>['sourceStates']
}>()

defineEmits<{
  retry: []
}>()

function kindLabel(kind: SettlementSource['kind']): string {
  return kind === 'contract-supplement' ? '补充协议' : kind === 'owner-change' ? '甲方变洽签' : '收款登记'
}
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="final-settlement-sources-title">
    <SectionHeader
      id="final-settlement-sources-title"
      title="来源单据"
      subtitle="只列入变更后合同额或累计收款计算的有效事实"
    />
    <StatePanel v-if="receiptsProblem" class="mt-3" :kind="receiptsProblem.code === 'forbidden' ? 'forbidden' : 'error'" title="收款事实暂不可用" :description="receiptsProblem.message" action-label="重新读取" compact @action="$emit('retry')" />
    <template v-for="item in [{ key: 'supplements' as const, label: '补充协议' }, { key: 'changes' as const, label: '已签证变洽签' }, { key: 'receipts' as const, label: '收款' }]" :key="item.key">
      <StatePanel
        v-if="sourceStates && sourceStates[item.key] !== 'readable' && !(item.key === 'receipts' && receiptsProblem)"
        class="mt-3"
        :kind="sourceStates[item.key] === 'forbidden' ? 'forbidden' : 'error'"
        :title="`${item.label}来源不可用`"
        :description="`尚未取得当前可读取的${item.label}事实，相关金额保持未知。`"
        compact
      />
    </template>
    <StatePanel
      v-if="sources === null"
      class="mt-3"
      kind="error"
      title="来源事实未读取"
      description="补充协议、已签证变洽签或收款登记尚未完整读取，当前不按空数据处理。"
      action-label="重新加载"
      compact
      @action="$emit('retry')"
    />
    <div
      v-else-if="sources.length"
      class="mt-3 overflow-x-auto"
      data-testid="final-settlement-source-scroll"
      role="region"
      aria-label="最终结算来源单据，可横向滚动查看完整列"
      tabindex="0"
    >
      <table class="w-full min-w-720px border-collapse text-left text-12px">
        <thead class="bg-surface-2 text-ink-soft">
          <tr>
            <th class="px-3 py-2 font-600">
              类型
            </th>
            <th class="px-3 py-2 font-600">
              编号
            </th>
            <th class="px-3 py-2 font-600">
              名称
            </th>
            <th class="px-3 py-2 font-600">
              日期
            </th>
            <th class="px-3 py-2 text-right font-600">
              金额
            </th>
            <th class="px-3 py-2 font-600">
              状态
            </th>
            <th class="px-3 py-2 font-600">
              来源
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in sources" :key="`${source.kind}:${source.id}`" class="border-t border-line">
            <td class="px-3 py-2.5">
              {{ kindLabel(source.kind) }}
            </td>
            <td class="px-3 py-2.5 font-mono">
              {{ source.no || '未编号' }}
            </td>
            <td class="px-3 py-2.5 font-600 text-ink">
              {{ source.name }}
            </td>
            <td class="px-3 py-2.5 font-mono">
              {{ source.date || '未记录' }}
            </td>
            <td class="px-3 py-2.5 text-right font-mono font-700">
              {{ source.amount === null ? '未记录' : yuan(Number(source.amount)) }}
            </td>
            <td class="px-3 py-2.5">
              {{ source.statusLabel }}
            </td>
            <td class="px-3 py-2.5">
              <ReceiptSourceLink v-if="source.kind === 'receipt'" :intent="source.navigation" :return-to="returnTo" :anchor-id="`final-settlement-receipt-${source.id}`" label="查看收款" />
              <EntityLink
                v-else-if="source.kind === 'owner-change'"
                type="contract"
                :intent="source.navigation"
                label="查看变洽签"
                :return-to="returnTo"
              />
              <EntityLink
                v-else
                type="contract"
                :intent="source.navigation"
                label="查看补充协议"
                :return-to="returnTo"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <StatePanel
      v-else
      class="mt-3"
      kind="empty"
      title="暂无有效来源单据"
      description="当前没有已读取的有效来源记录；未接通或无权读取的来源保持未知。"
      compact
    />
  </section>
</template>
