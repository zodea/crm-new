<script setup lang="ts">
import type { MaterialContractDetailReadDTO, MaterialContractFactDTO } from '~/lib/material-contract/repository'
import type { DataOriginDTO, NavigationIntentDTO, ReadState } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import { validateMaterialContractReturnTo } from '~/lib/material-contract/return-context'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useMaterialContractReadStore } from '~/stores/material-contract-read'

const props = defineProps<{ contractId: string, origin: DataOriginDTO }>()
const route = useRoute()
const router = useRouter()
const store = useMaterialContractReadStore()
const visibilityStore = useDataVisibilityStore()

const state = computed(() => store.detailState as ReadState<MaterialContractDetailReadDTO>)
const detail = computed(() => {
  const current = state.value
  if (current.kind === 'ready')
    return current.data
  if ((current.kind === 'loading' || current.kind === 'error') && current.previous)
    return current.previous
  return null
})
const loading = computed(() => state.value.kind === 'loading')
const tabs = computed(() => [
  { key: 'info', label: '详细信息' },
  { key: 'lines', label: `采购明细 ${detail.value?.sections.lineItems.length ?? 0}` },
  { key: 'materials', label: '材料管理' },
  { key: 'invoices', label: `发票登记 ${detail.value?.sections.invoices.length ?? 0}` },
  { key: 'payments', label: `付款信息 ${detail.value?.sections.payments.length ?? 0}` },
  { key: 'settlements', label: `支出结算 ${detail.value?.sections.settlements.length ?? 0}` },
  { key: 'penalties', label: `项目扣罚 ${detail.value?.sections.penalties.length ?? 0}` },
])
const tabKeys = new Set(tabs.value.map(tab => tab.key))
const activeTab = computed({
  get: () => typeof route.query.tab === 'string' && tabKeys.has(route.query.tab) ? route.query.tab : 'info',
  set: value => void router.replace({ query: { ...route.query, tab: value === 'info' ? undefined : value } }),
})
const returnTo = computed(() => validateMaterialContractReturnTo(route.query.returnTo, props.origin) ?? '/contract/material')
const canEdit = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('material-contract:write'))
const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
  if (detail.value)
    return 'ready'
  if (state.value.kind === 'idle' || state.value.kind === 'loading')
    return 'loading'
  if (state.value.kind === 'forbidden')
    return 'forbidden'
  if (state.value.kind === 'not-found')
    return 'not-found'
  return 'error'
})
const problem = computed(() => 'problem' in state.value ? state.value.problem : null)
const stateTitle = computed(() => state.value.kind === 'mismatch'
  ? '合同来源或类别不匹配'
  : shellState.value === 'loading' ? '正在读取材料采购合同' : shellState.value === 'forbidden' ? '无权查看该材料采购合同' : shellState.value === 'not-found' ? '未找到材料采购合同' : '材料采购合同读取失败')

function target(intent: NavigationIntentDTO): string | null {
  const result = resolveNavigationTarget(intent)
  return result.state === 'resolved' ? result.to : null
}

const supplierFactLinks = computed(() => {
  const navigation = detail.value?.supplierNavigation
  if (!navigation || (navigation.kind !== 'entity-detail' && navigation.kind !== 'entity-subview'))
    return []
  const rows = [
    { view: 'contracts', label: '查看分供方合同事实' },
    { view: 'settlements', label: '查看分供方结算事实' },
    { view: 'invoices', label: '查看分供方收票事实' },
    { view: 'payments', label: '查看分供方付款事实' },
  ] as const
  return rows.flatMap((row) => {
    const result = resolveNavigationTarget({
      ...navigation,
      kind: 'entity-subview',
      variant: 'detail',
      view: row.view,
    }, { returnTo: route.fullPath })
    return result.state === 'resolved' ? [{ ...row, to: result.to }] : []
  })
})

const metrics = computed(() => {
  const amounts = detail.value?.contract.amounts
  if (!amounts)
    return []
  const rows: Array<[string, string]> = [
    ['合同金额', amounts.contract],
    ['变更后金额', amounts.changed],
    ['累计结算', amounts.settled],
    ['累计收票', amounts.invoiced],
    ['累计支付', amounts.paid],
    ['应付余额', amounts.payable],
  ]
  return rows.map(([label, value]) => ({ label, value: yuan(Number(value)) }))
})

function load() {
  return store.loadDetail({
    id: props.contractId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
  })
}

function edit() {
  void navigateTo({
    path: `/contract/material/form/${encodeURIComponent(props.contractId)}`,
    query: { origin: 'real', contractKind: 'material', returnTo: route.fullPath },
  })
}

function factSection(title: string, rows: readonly MaterialContractFactDTO[], emptyLabel: string) {
  return { title, rows, emptyLabel }
}

const materialSections = computed(() => {
  const rows = detail.value?.sections.materials
  if (!rows)
    return []
  return [
    factSection('下料单', rows.requisitions, '暂无关联下料单'),
    factSection('到货验收', rows.arrivals, '暂无关联到货验收记录'),
    factSection('直调记录', rows.directTransfers, '暂无关联直调记录'),
    factSection('出库记录', rows.outbound, '暂无关联出库记录'),
  ]
})

watch(() => [props.contractId, props.origin], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.contract.name ?? '材料采购合同详情')
</script>

<template>
  <div class="material-contract-detail min-w-0" data-testid="material-contract-detail">
    <EntityDetailShell
      :title="detail?.contract.name ?? '材料采购合同详情'"
      :subtitle="detail?.contract.no || '编号未填写'"
      :back-to="returnTo"
      back-label="返回材料采购合同列表"
      :state="shellState"
      :state-title="stateTitle"
      :state-description="problem?.message ?? ''"
      :state-action-label="problem?.retryable ? '重新加载' : ''"
      @state-action="load"
    >
      <template #status>
        <template v-if="detail">
          <span class="chip" :class="detail.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">
            {{ detail.dataOrigin === 'demo' ? '演示只读' : '正式数据' }}
          </span>
          <span class="chip bg-surface-3 text-ink-soft">{{ detail.contract.status }}</span>
        </template>
      </template>
      <template #actions>
        <button v-if="canEdit" type="button" class="btn-secondary" data-testid="material-contract-edit" @click="edit">
          编辑合同
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="6">
          <Metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel
          v-if="state.kind === 'error'"
          kind="error"
          title="刷新材料采购合同失败"
          :description="`${state.problem.message}；当前保留上一次成功读取的详情。`"
          :action-label="state.problem.retryable ? '重新加载' : ''"
          compact
          @action="load"
        />

        <div class="panel min-w-0 overflow-hidden px-3">
          <SegTab v-model="activeTab" :tabs="tabs" />
        </div>

        <section v-if="supplierFactLinks.length" class="panel flex min-w-0 flex-wrap items-center gap-2 p-3" aria-label="分供方关联事实">
          <span class="mr-auto text-12px font-700 text-ink-soft">分供方关联事实</span>
          <NuxtLink
            v-for="link in supplierFactLinks"
            :key="link.view"
            :to="link.to"
            class="btn-ghost"
            :aria-label="link.label"
          >
            {{ link.label.replace('查看分供方', '') }}
          </NuxtLink>
        </section>

        <section v-if="activeTab === 'info'" class="panel p-4">
          <SectionHeader title="详细信息" subtitle="仅展示中央读模型已核验字段；敏感字段按权限脱敏" />
          <div class="material-contract-grid mt-3">
            <div class="detail-row">
              <span>所属项目</span><NuxtLink v-if="target(detail.projectNavigation)" :to="target(detail.projectNavigation)!" class="text-brand hover:underline">
                {{ detail.contract.project.state === 'resolved' ? detail.contract.project.label : '不可用' }}
              </NuxtLink><strong v-else>不可用</strong>
            </div>
            <div class="detail-row">
              <span>分供方</span><NuxtLink v-if="target(detail.supplierNavigation)" :to="target(detail.supplierNavigation)!" class="text-brand hover:underline">
                {{ detail.contract.supplier.state === 'resolved' ? detail.contract.supplier.label : '不可用' }}
              </NuxtLink><strong v-else>不可用</strong>
            </div>
            <div class="detail-row">
              <span>签约日期</span><strong>{{ detail.contract.signDate || '—' }}</strong>
            </div>
            <div class="detail-row">
              <span>发票类型</span><strong>{{ detail.contract.invoiceType || '—' }}</strong>
            </div>
            <div class="detail-row">
              <span>履约联系人</span><strong>{{ detail.contract.contactName || '—' }}</strong>
            </div>
            <div class="detail-row">
              <span>联系电话</span><strong>{{ detail.contract.contactPhone || '—' }}</strong>
            </div>
            <div class="detail-row full">
              <span>合同内容</span><strong>{{ detail.contract.content || '—' }}</strong>
            </div>
            <div class="detail-row full">
              <span>主要条款</span><strong>{{ detail.contract.mainTerms || '—' }}</strong>
            </div>
            <div class="detail-row full">
              <span>付款条款</span><strong>{{ detail.contract.paymentTerms || '—' }}</strong>
            </div>
            <div class="detail-row full">
              <span>品牌质量条款</span><strong>{{ detail.contract.brandQualityTerms || '—' }}</strong>
            </div>
            <div class="detail-row full">
              <span>进度条款</span><strong>{{ detail.contract.scheduleTerms || '—' }}</strong>
            </div>
            <div class="detail-row full">
              <span>质保条款</span><strong>{{ detail.contract.warrantyTerms || '—' }}</strong>
            </div>
          </div>
          <SectionHeader class="mt-5" title="合同文件" />
          <ul v-if="detail.sections.files.length" class="mt-2 divide-y divide-line rounded border border-line">
            <li v-for="file in detail.sections.files" :key="file.id" class="flex flex-wrap items-center justify-between gap-2 p-3 text-12px">
              <span>{{ file.fileName }}</span><span class="text-ink-soft">{{ file.category }} · {{ file.fileSize }} B</span>
            </li>
          </ul>
          <p v-else class="p-6 text-center text-13px text-ink-soft">
            暂无合同文件
          </p>
        </section>

        <section v-else-if="activeTab === 'lines'" class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader title="采购明细" />
          <div class="material-fact-scroll mt-3" data-testid="material-contract-lines-scroll">
            <table v-if="detail.sections.lineItems.length" class="material-fact-table">
              <thead>
                <tr>
                  <th>物资名称</th><th>规格</th><th>品牌</th><th>单位</th><th class="text-right">
                    数量
                  </th><th class="text-right">
                    含税单价
                  </th><th class="text-right">
                    含税合价
                  </th><th>计划到货</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in detail.sections.lineItems" :key="row.id">
                  <td>{{ row.materialName }}</td><td>{{ row.spec || '—' }}</td><td>{{ row.brand || '—' }}</td><td>{{ row.unit || '—' }}</td><td class="text-right">
                    {{ row.qty ?? '—' }}
                  </td><td class="text-right">
                    {{ row.unitPrice == null ? '—' : yuan(Number(row.unitPrice)) }}
                  </td><td class="text-right">
                    {{ row.amount == null ? '—' : yuan(Number(row.amount)) }}
                  </td><td>{{ row.plannedArrivalDate || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="p-8 text-center text-13px text-ink-soft">
              暂无采购明细
            </p>
          </div>
        </section>

        <section v-else-if="activeTab === 'materials'" class="space-y-3">
          <div v-for="section in materialSections" :key="section.title" class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader :title="section.title" />
            <MaterialContractFactTable class="mt-3" :rows="section.rows" :empty-label="section.emptyLabel" />
          </div>
        </section>

        <section v-else class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader :title="tabs.find(item => item.key === activeTab)?.label ?? ''" />
          <MaterialContractFactTable v-if="activeTab === 'invoices'" class="mt-3" :rows="detail.sections.invoices" empty-label="暂无关联发票登记" />
          <MaterialContractFactTable v-else-if="activeTab === 'payments'" class="mt-3" :rows="detail.sections.payments" empty-label="暂无关联付款信息" paid-column />
          <MaterialContractFactTable v-else-if="activeTab === 'settlements'" class="mt-3" :rows="detail.sections.settlements" empty-label="暂无关联支出结算" />
          <MaterialContractFactTable v-else class="mt-3" :rows="detail.sections.penalties" empty-label="暂无关联项目扣罚" />
        </section>

        <div v-if="loading" class="fixed bottom-4 right-4 chip chip-brand" role="status">
          正在刷新中央详情…
        </div>
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.material-contract-detail { container-type: inline-size; }
.material-contract-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 0 28px; }
.detail-row { display: flex; min-width: 0; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.detail-row > span { width: 104px; flex: none; color: var(--ink-soft); }
.detail-row > strong { min-width: 0; overflow-wrap: anywhere; }
.detail-row.full { grid-column: 1 / -1; }
.material-fact-scroll { min-width: 0; overflow-x: auto; }
.material-fact-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 12px; }
.material-fact-table th { padding: 9px 10px; text-align: left; color: var(--ink-soft); background: var(--surface-2); white-space: nowrap; }
.material-fact-table td { padding: 10px; border-top: 1px solid var(--line); }
</style>
