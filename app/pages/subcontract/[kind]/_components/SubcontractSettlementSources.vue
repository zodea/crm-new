<script setup lang="ts">
import type { SubcontractSettlementEvidenceRead, SubcontractSettlementSourceSection } from '~/lib/owner-document/subcontract-settlement'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import { yuan } from '~/lib/util/money'

defineProps<{ evidence?: SubcontractSettlementEvidenceRead, returnTo: string }>()
const sections: Array<{ key: SubcontractSettlementSourceSection, title: string }> = [
  { key: 'supplements', title: '有效补充协议' },
  { key: 'changes', title: '分包变洽签' },
  { key: 'settlements', title: '本期与往期结算' },
  { key: 'penalties', title: '项目罚扣与独立抵扣' },
  { key: 'applications', title: '付款申请与批复' },
  { key: 'payments', title: '实际支付来源' },
]
const money = (value: string | null | undefined) => value == null ? '未知' : yuan(Number(value))
const statusLabel = (status: string) => ({ draft: '草稿', submitted: '已提交', approved: '已审批', confirmed: '已确认', pending: '待抵扣', paying: '付款中', paid: '已付款', deducted: '已抵扣', rectified: '已整改', rejected: '已退回' } as Record<string, string>)[status] ?? status
</script>

<template>
  <div class="min-w-0 space-y-3" data-testid="subcontract-settlement-sources">
    <section v-for="section in sections" :key="section.key" class="panel min-w-0 p-4" :aria-label="section.title">
      <SectionHeader :title="section.title">
        <template v-if="section.key === 'payments'" #extra>
          <ContextHelp label="本单支付归属" text="付款申请只关联本单时，显示真实支付分摊；同一申请关联多张结算且未逐单分摊支付时，本单支付金额保持未知。" />
        </template>
      </SectionHeader>
      <StatePanel v-if="evidence?.sections[section.key] == null" class="mt-3" kind="error" :title="`${section.title}来源缺口`" description="尚未取得可完整核验的真实来源，相关金额保持未知。" compact />
      <StatePanel v-else-if="!evidence.sections[section.key]!.length" class="mt-3" kind="empty" title="暂无相关来源单据" description="已读取的范围内没有记录。" compact />
      <div v-else class="mt-3 overflow-x-auto" role="region" :aria-label="`${section.title}，可横向滚动查看完整列`" tabindex="0">
        <table class="w-full min-w-900px border-collapse text-left text-12px">
          <thead class="bg-surface-2 text-ink-soft">
            <tr>
              <th class="px-3 py-2 font-600">
                编号／名称
              </th>
              <th class="px-3 py-2 font-600">
                日期
              </th>
              <th class="px-3 py-2 text-right font-600">
                原单金额
              </th>
              <th v-if="section.key === 'applications'" class="px-3 py-2 text-right font-600">
                批复金额
              </th>
              <th v-if="['penalties', 'applications', 'payments'].includes(section.key)" class="px-3 py-2 text-right font-600">
                本单抵扣／分摊
              </th>
              <th class="px-3 py-2 font-600">
                状态
              </th>
              <th class="px-3 py-2 font-600">
                采用说明
              </th>
              <th class="px-3 py-2 font-600">
                来源
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in evidence.sections[section.key]" :key="row.id" class="border-t border-line">
              <td class="px-3 py-2.5">
                <span class="block font-mono">{{ row.no || '未编号' }}</span><strong class="font-600">{{ row.name || '原单未记名称' }}</strong>
              </td>
              <td class="px-3 py-2.5 font-mono">
                {{ row.date || '未记录' }}
              </td>
              <td class="px-3 py-2.5 text-right font-mono">
                {{ money(row.amount) }}
              </td>
              <td v-if="section.key === 'applications'" class="px-3 py-2.5 text-right font-mono">
                {{ row.approvedAmountState === 'legacy-unknown' ? '历史批复待核验' : row.approvedAmountState === 'not-entered' ? '未填写' : money(row.approvedAmount) }}
              </td>
              <td v-if="['penalties', 'applications', 'payments'].includes(section.key)" class="px-3 py-2.5 text-right font-mono">
                {{ money(row.allocatedAmount) }}
              </td>
              <td class="px-3 py-2.5">
                {{ statusLabel(row.status) }}
              </td>
              <td class="max-w-300px px-3 py-2.5 text-ink-soft">
                {{ row.note || '保留原来源事实' }}
              </td>
              <td class="px-3 py-2.5">
                <EntityLink type="contract" :intent="row.navigation" :label="section.key === 'payments' ? '查看原申请与支付' : '查看原单'" :return-to="returnTo" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
