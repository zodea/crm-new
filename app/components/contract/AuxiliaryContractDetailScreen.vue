<script setup lang="ts">
import type { AuxiliaryContractKind } from '~/lib/auxiliary-contract/contract'
import type { EntityRefDTO } from '~/types/read-model'
import AuxiliaryContractInfo from '~/components/contract/AuxiliaryContractInfo.vue'
import ConstructionScopeSelector from '~/components/contract/ConstructionScopeSelector.vue'
import ContractOriginalFilesPanel from '~/components/contract/ContractOriginalFilesPanel.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { AUXILIARY_LABELS, auxiliaryListPath } from '~/lib/auxiliary-contract/contract'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'
import { contractAuxStatusTone } from '~/lib/contract/aux-list'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ kind: AuxiliaryContractKind, contractId: string }>()
const detailRoot = useTemplateRef<HTMLElement>('detailRoot')
const settlementNavigation = useOtherSettlementNavigation(detailRoot)
const route = useRoute()
const repository = useNuxtApp().$repositories.auxiliaryContracts
const { data: detail, shellState, problem, load } = useAuxiliaryContractRead(() => repository.detail(props.contractId, { kind: props.kind, origin: route.query.origin ?? 'real' }))
const contract = computed(() => detail.value?.contract ?? null)
const tabs = computed(() => [{ key: 'info', label: '详细资料' }, { key: 'invoice', label: '收票登记' }, { key: 'payment', label: '付款信息' }, ...(props.kind === 'other_expense' ? [{ key: 'settlement', label: '支出结算' }, { key: 'supplement', label: '增补合同' }] : [])])
const activeTab = computed(() => tabs.value.some(tab => tab.key === route.query.tab) ? String(route.query.tab) : 'info')
const facts = computed(() => detail.value?.facts.filter(row => row.kind === activeTab.value) ?? [])
const emptyFactLabels: Record<string, string> = { invoice: '暂无收票记录', payment: '暂无支付记录', settlement: '暂无支出结算', supplement: '暂无增补合同' }
const noFacts = computed(() => detail.value?.unavailableFactKinds?.includes(activeTab.value as 'invoice' | 'payment' | 'settlement' | 'supplement') ? '此真实来源尚不可核验，金额未知；不能将空集合当作零。' : emptyFactLabels[activeTab.value] ?? '')
const backTo = computed(() => validateAuxiliaryReturnTo(route.query.returnTo, route.query.origin ?? 'real') ?? auxiliaryListPath(props.kind))
const metrics = computed(() => contract.value
  ? [
      { label: '含税合同金额', value: contract.value.amounts.contract },
      ...(props.kind === 'other_expense' ? [{ label: '变更后合同金额', value: contract.value.amounts.changed }, { label: '累计结算', value: contract.value.amounts.settled, tab: 'settlement' }] : [{ label: '无税合同金额', value: contract.value.amounts.taxExclusive }, { label: '税额', value: contract.value.amounts.tax }]),
      { label: '累计收票', value: contract.value.amounts.invoiced, tab: 'invoice' },
      { label: '累计支付', value: contract.value.amounts.paid, tab: 'payment' },
      { label: '按收票应付', value: contract.value.amounts.byInvoicePayable },
    ]
  : [])
function relation(ref: EntityRefDTO | null) {
  if (!ref)
    return null
  const target = resolveNavigationTarget({ kind: 'entity-detail', subject: ref, variant: 'detail', view: null, filters: { dataOrigin: contract.value?.dataOrigin ?? 'real' } }, { returnTo: route.fullPath })
  return target.state === 'resolved' ? target.to : null
}
function selectTab(tab: string) {
  void navigateTo({ path: route.path, query: { ...route.query, tab } }, { replace: true })
}
watch(() => `${props.kind}:${props.contractId}:${route.query.origin}`, () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => contract.value?.draft.name || AUXILIARY_LABELS[props.kind])
</script>

<template>
  <div ref="detailRoot" class="min-w-0" :data-state="shellState">
    <EntityDetailShell :title="contract?.draft.name || AUXILIARY_LABELS[kind]" :subtitle="`${AUXILIARY_LABELS[kind]} · ${contract?.draft.no || '编号未记录'}`" :state="shellState" :state-title="problem?.message" :state-action-label="problem?.retryable ? '重新加载' : ''" @state-action="load">
      <template #back>
        <KitButton aria-label="返回来源" @click="navigateTo(backTo)">
          返回
        </KitButton>
      </template>
      <template #status>
        <KitStatusTag :tone="contractAuxStatusTone(contract?.draft.status ?? '')">
          {{ contract?.draft.status || '未记录' }}
        </KitStatusTag>
      </template>
      <template #actions>
        <KitButton v-if="detail?.capabilities.includes('auxiliary-contract:write') && contract?.dataOrigin === 'real'" variant="primary" @click="navigateTo(`${auxiliaryListPath(kind)}/form/${contractId}?origin=real&returnTo=${encodeURIComponent(route.fullPath)}`)">
          编辑合同
        </KitButton>
      </template>
      <template #summary>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(145px,1fr))] gap-3">
          <div v-for="metric in metrics" :key="metric.label" class="min-w-0 border-r border-line px-2">
            <p class="m-0 text-12px text-ink-soft">
              {{ metric.label }}
            </p><button v-if="metric.tab && metric.value !== null" class="mt-1 cursor-pointer border-0 bg-transparent p-0 font-mono text-16px font-700 text-brand" @click="selectTab(metric.tab)">
              {{ auxiliaryMoney(metric.value) }}
            </button><strong v-else class="mt-1 block font-mono text-16px">{{ auxiliaryMoney(metric.value) }}</strong>
          </div>
        </div>
      </template>
      <div v-if="detail && contract" class="min-w-0" data-testid="auxiliary-detail">
        <p v-for="message in detail.diagnostics ?? []" :key="message" role="status" class="rounded border border-warn/30 p-3 text-12px text-warn">
          {{ message }}
        </p>
        <nav class="mb-3 flex flex-wrap gap-1 border-b border-line" aria-label="合同详情页签">
          <button v-for="tab in tabs" :key="tab.key" class="cursor-pointer border-0 border-b-2 bg-transparent px-4 py-2 text-13px" :class="activeTab === tab.key ? 'border-brand font-700 text-brand' : 'border-transparent text-ink-soft'" :aria-current="activeTab === tab.key ? 'page' : undefined" @click="selectTab(tab.key)">
            {{ tab.label }}
          </button>
        </nav>
        <template v-if="activeTab === 'info'">
          <ConstructionScopeSelector v-if="kind === 'other_expense' && detail.capabilities.includes('construction-scope:read')" :source="{ domain: 'auxiliary-contract', id: contractId }" @saved="load" />
          <AuxiliaryContractInfo :contract="contract" :attachments="detail.attachments" :project-to="relation(contract.project)" :supplier-to="relation(contract.supplier)" />
          <ContractOriginalFilesPanel :owner-id="contractId" origin="real" :source-version="detail.sourceVersion" :can-read="shellState === 'ready' && detail.capabilities.includes('auxiliary-contract:read')" :files="detail.attachments" :read-content="repository.fileContent" />
        </template>
        <section v-else class="panel min-w-0 p-3">
          <div v-if="activeTab === 'settlement' && kind === 'other_expense'" class="mb-3 flex flex-wrap gap-3">
            <NuxtLink id="other-settlements-list" :to="{ path: '/contract/other-settlement', query: { origin: 'real', contractId, projectId: contract.draft.projectId, supplierId: contract.draft.supplierId, returnTo: settlementNavigation.context('other-settlements-list') } }" class="text-13px text-brand underline" @click="settlementNavigation.remember('other-settlements-list')">
              查看全部结算
            </NuxtLink>
            <KitButton v-if="detail.capabilities.includes('other-settlement:write') && contract.draft.status !== '草稿'" variant="primary" @click="navigateTo({ path: '/contract/other-settlement/form', query: { contractId, returnTo: settlementNavigation.context('other-settlements-list') } })">
              新建结算
            </KitButton>
          </div>
          <div class="min-w-0 overflow-x-auto" role="region" tabindex="0" aria-label="合同关联事实表">
            <table class="w-full min-w-160 border-collapse text-left text-13px">
              <thead class="bg-surface-2 text-ink-soft">
                <tr>
                  <th class="p-2">
                    编号
                  </th><th>名称</th><th>日期</th><th>金额</th><th>状态</th>
                </tr>
              </thead><tbody>
                <tr v-for="fact in facts" :key="fact.id" class="border-b border-line">
                  <td class="p-2">
                    {{ fact.no || '未记录' }}
                  </td><td>
                    <NuxtLink v-if="fact.kind === 'settlement'" :id="`contract-settlement-${fact.id}`" :to="{ path: `/contract/other-settlement/${fact.id}`, query: { origin: 'real', contractId, returnTo: settlementNavigation.context(`contract-settlement-${fact.id}`) } }" class="text-brand underline" @click="settlementNavigation.remember(`contract-settlement-${fact.id}`)">
                      {{ fact.name || '未命名结算' }}
                    </NuxtLink><span v-else>{{ fact.name || '未记录' }}</span>
                  </td><td>{{ fact.date || '未记录' }}</td><td class="font-mono">
                    {{ auxiliaryMoney(fact.amount) }}
                  </td><td><KitStatusTag>{{ fact.status || '未记录' }}</KitStatusTag></td>
                </tr><tr v-if="!facts.length">
                  <td colspan="5" class="p-8 text-center text-ink-faint">
                    {{ noFacts }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div><p class="text-12px text-ink-faint">
            {{ activeTab === 'settlement' ? '结算按真实合同关系读取，名称进入结算只读详情。' : '记录按所属合同展示；暂无可用的来源详情入口。' }}
          </p>
        </section>
      </div>
    </EntityDetailShell>
  </div>
</template>
