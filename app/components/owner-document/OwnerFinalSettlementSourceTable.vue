<script setup lang="ts">
import type { OwnerCommercialDocumentDetailReadDTO } from '~/lib/owner-document/central-repository'
import { yuan } from '~/lib/util/money'

type SettlementSources = NonNullable<OwnerCommercialDocumentDetailReadDTO['finalSettlementEvidence']>['sources']
type SettlementSource = NonNullable<SettlementSources>[number]

defineProps<{
  sources: SettlementSources
  returnTo: string
}>()

defineEmits<{
  retry: []
}>()

function kindLabel(kind: SettlementSource['kind']): string {
  return kind === 'contract-supplement' ? '补充协议' : '收款登记'
}
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="final-settlement-sources-title">
    <SectionHeader
      id="final-settlement-sources-title"
      title="来源单据"
      subtitle="只列入变更后合同额或累计收款计算的有效事实"
    />
    <StatePanel
      v-if="sources === null"
      class="mt-3"
      kind="error"
      title="来源事实未读取"
      description="补充协议或收款登记尚未完整读取，当前不按空数据处理。"
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
              {{ yuan(Number(source.amount)) }}
            </td>
            <td class="px-3 py-2.5">
              {{ source.statusLabel }}
            </td>
            <td class="px-3 py-2.5">
              <EntityLink
                :type="source.kind === 'receipt' ? 'receipt' : 'contract'"
                :intent="source.navigation"
                :label="source.kind === 'receipt' ? '查看收款' : '查看补充协议'"
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
      description="当前没有可计入的补充协议或收款登记；未知事实不会按 0 展示。"
      compact
    />
  </section>
</template>
