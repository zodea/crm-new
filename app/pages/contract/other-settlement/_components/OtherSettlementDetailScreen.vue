<script setup lang="ts">
import type { OtherSettlementFact } from '~/lib/other-settlement/contract'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'
import { isConfirmedExpenditureSettlement } from '~/lib/contract/effective-status'
import { OTHER_SETTLEMENT_PATH, OTHER_SETTLEMENT_STATUS_LABELS } from '~/lib/other-settlement/contract'
import OtherSettlementFacts from '~/pages/contract/other-settlement/_components/OtherSettlementFacts.vue'
import OtherSettlementInfo from '~/pages/contract/other-settlement/_components/OtherSettlementInfo.vue'

const props = defineProps<{
  settlementId: string
}>()
const route = useRoute()
const root = useTemplateRef<HTMLElement>('root')
const navigation = useOtherSettlementNavigation(root)
const repository = useNuxtApp().$repositories.otherSettlements
const { data: detail, problem, shellState, load } = useAuxiliaryContractRead(() => repository.detail(props.settlementId, { origin: route.query.origin ?? 'real', contractId: route.query.contractId }))
const settlement = computed(() => detail.value?.settlement)
const tabs = [{ key: 'info', label: '详细资料' }, { key: 'penalty', label: '奖罚抵扣' }, { key: 'application', label: '付款申请' }, { key: 'payment', label: '支付事实' }] as const
const activeTab = computed(() => tabs.find(tab => tab.key === route.query.tab)?.key ?? 'info')
const status = computed(() => OTHER_SETTLEMENT_STATUS_LABELS[settlement.value?.draft.status ?? ''] || '未记录')
function factUnavailableReason(kind: OtherSettlementFact['kind']) {
  const keys = { penalty: 'deductions', application: 'applied', payment: 'paid' } as const
  return settlement.value?.amounts[keys[kind]] === null ? settlement.value.qualificationUnavailableReason || '当前真实来源或归属不可核验，完整金额未知；已核验明细继续保留，不能把缺口当作零。' : null
}
const backTo = computed(() => validateAuxiliaryReturnTo(route.query.returnTo) ?? OTHER_SETTLEMENT_PATH)
const canEdit = computed(() => detail.value?.capabilities.includes('other-settlement:write') && settlement.value?.version !== '0' && !isConfirmedExpenditureSettlement(settlement.value?.draft.status ?? ''))
const canLinkClearance = computed(() => detail.value?.capabilities.includes('other-settlement:write') && isConfirmedExpenditureSettlement(settlement.value?.draft.status ?? '') && Boolean(settlement.value?.expenseAllocations?.length))
function tab(key: string) {
  void navigateTo({ path: route.path, query: { ...route.query, tab: key, fact: undefined }, hash: '' }, { replace: true })
}
function selectFact(id: string) {
  navigation.remember(`fact-${id}`)
  void navigateTo({ path: route.path, query: { ...route.query, fact: id, sourceTrail: undefined }, hash: '' }, { replace: true })
}
const sourceTrail = computed(() => String(route.query.sourceTrail ?? '').split(',').filter(id => detail.value?.facts?.some(f => f.id === id)).slice(-4))
function openSource(fact: OtherSettlementFact) {
  const current = String(route.query.fact ?? '')
  void navigateTo({ path: route.path, query: { ...route.query, tab: fact.kind, fact: fact.id, sourceTrail: [...sourceTrail.value, current].slice(-4).join(',') }, hash: '' }, { replace: true })
}
function closeFact() {
  const trail = [...sourceTrail.value]
  const previousId = trail.pop()
  const previous = detail.value?.facts?.find(f => f.id === previousId)
  if (previous) {
    void navigateTo({ path: route.path, query: { ...route.query, tab: previous.kind, fact: previous.id, sourceTrail: trail.join(',') || undefined }, hash: '' }, { replace: true })
    return
  }
  const id = String(route.query.fact ?? '')
  void navigateTo({ path: route.path, query: { ...route.query, fact: undefined }, hash: `#fact-${id}` }, { replace: true })
}
watch(() => `${props.settlementId}:${route.query.origin}:${route.query.contractId}`, load, { immediate: true })
onActivated(load)
useTabTitle(() => settlement.value?.draft.name || '其他支出结算')
</script>

<template>
  <div ref="root" class="min-w-0" data-testid="other-settlement-detail">
    <EntityDetailShell :title="settlement?.draft.name || '其他支出结算详情'" :subtitle="`其他支出结算 · ${settlement?.draft.no || '编号未记录'}`" :state="shellState" :state-title="problem?.message" :state-action-label="problem?.retryable ? '重新加载' : ''" @state-action="load">
      <template #back>
        <KitButton aria-label="返回来源" @click="navigateTo(backTo)">
          返回
        </KitButton>
      </template>
      <template #status>
        <span class="chip chip-brand">{{ status }}</span>
      </template>
      <template #actions>
        <KitButton v-if="canLinkClearance" @click="navigateTo(`${OTHER_SETTLEMENT_PATH}/form/${settlementId}?origin=real&returnTo=${encodeURIComponent(route.fullPath)}`)">
          核对旧份额关联
        </KitButton>
        <KitButton v-if="canEdit" variant="primary" @click="navigateTo(`${OTHER_SETTLEMENT_PATH}/form/${settlementId}?origin=real&returnTo=${encodeURIComponent(route.fullPath)}`)">
          编辑结算
        </KitButton>
      </template>
      <template #summary>
        <div v-if="settlement" class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 text-13px">
          <div v-for="metric in [{ label: '含税结算金额', value: settlement.amounts.total, tab: undefined }, { label: '本次结算金额', value: settlement.amounts.net, tab: undefined }, { label: '累计申请付款', value: settlement.amounts.applied, tab: 'application' }, { label: '累计已付', value: settlement.amounts.paid, tab: 'payment' }]" :key="metric.label">
            <p class="m-0 mb-2 text-ink-soft">
              {{ metric.label }}
            </p><button v-if="metric.tab && metric.value !== null" class="cursor-pointer border-0 bg-transparent p-0 font-mono text-18px font-700 text-brand" @click="tab(metric.tab)">
              {{ auxiliaryMoney(metric.value) }}
            </button><strong v-else class="font-mono text-18px">{{ auxiliaryMoney(metric.value) }}</strong>
          </div>
        </div>
      </template>
      <TabsRoot v-if="detail" :model-value="activeTab" class="min-w-0" @update:model-value="tab(String($event))">
        <TabsList class="mb-3 flex flex-wrap border-b border-line" aria-label="结算详情页签">
          <TabsTrigger v-for="item in tabs" :key="item.key" :value="item.key" class="cursor-pointer border-0 border-b-2 bg-transparent px-4 py-3 text-13px" :class="activeTab === item.key ? 'border-brand font-700 text-brand' : 'border-transparent text-ink-soft'">
            {{ item.label }}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="info">
          <OtherSettlementInfo :detail="detail" />
        </TabsContent>
        <TabsContent v-for="kind in (['penalty', 'application', 'payment'] as const)" :key="kind" :value="kind">
          <OtherSettlementFacts :facts="detail.facts" :kind="kind" :unavailable-reason="factUnavailableReason(kind)" :selected-id="typeof route.query.fact === 'string' ? route.query.fact : undefined" @select="selectFact" @source="openSource" @close="closeFact" />
        </TabsContent>
      </TabsRoot>
    </EntityDetailShell>
  </div>
</template>
