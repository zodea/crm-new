<script setup lang="ts">
import type { MaterialContractDetailReadDTO, MaterialContractFactDTO } from '~/lib/material-contract/repository'
import type { DataOriginDTO, NavigationIntentDTO, ReadState } from '~/types/read-model'
import { computed, nextTick, onActivated, ref, watch } from 'vue'
import ContractOriginalFilesPanel from '~/components/contract/ContractOriginalFilesPanel.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { contractStatusTone } from '~/lib/contract/status'
import { materialContractReferenceLabel } from '~/lib/material-contract/reference-state'
import {
  createMaterialContractJourneyReturnOrigin,
  loadMaterialContractJourneyReturnOrigin,
  newMaterialContractReturnContextId,
  resolveMaterialContractJourneyReturnOrigin,
  saveMaterialContractJourneyReturnOrigin,
  validateMaterialContractDetailJourneyReturnTo,
  validateMaterialContractReturnTo,
} from '~/lib/material-contract/return-context'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { readProblemTitle, readStateData, readStateProblem } from '~/lib/read-model/state'
import { yuan } from '~/lib/util/money'
import MaterialContractFactTable from '~/pages/contract/_components/MaterialContractFactTable.vue'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useMaterialContractReadStore } from '~/stores/material-contract-read'

const props = defineProps<{ contractId: string, origin: DataOriginDTO }>()
const route = useRoute()
const router = useRouter()
const store = useMaterialContractReadStore()
const repository = useNuxtApp().$repositories.materialContractRead
const visibilityStore = useDataVisibilityStore()
const supplierFactContextId = ref(newMaterialContractReturnContextId())

const state = computed(() => store.detailState as ReadState<MaterialContractDetailReadDTO>)
const detail = computed(() => readStateData(state.value))
const loading = computed(() => state.value.kind === 'loading')
const canReadOriginals = computed(() => state.value.kind === 'ready' && state.value.data.dataOrigin === 'real' && state.value.data.capabilities.includes('material-contract:read'))
function ownerFiles(ownerId: string) {
  return (detail.value?.sections.files ?? []).filter(file => (file.ownerId ?? detail.value?.contract.id) === ownerId).map(file => ({ ...file, uploadedAt: file.uploadedAt ?? '' }))
}
const tabs = computed(() => [
  { key: 'info', label: '详细信息' },
  { key: 'lines', label: `采购明细 ${detail.value?.sections.lineItems.length ?? 0}` },
  { key: 'supplements', label: `补充协议 ${detail.value?.sections.supplements?.length ?? 0}` },
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
const canEdit = computed(() => state.value.kind === 'ready' && detail.value?.dataOrigin === 'real'
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
const problem = computed(() => readStateProblem(state.value))
const stateTitle = computed(() => readProblemTitle(problem.value, state.value.kind === 'mismatch'
  ? '合同来源或类别不匹配'
  : shellState.value === 'loading' ? '正在读取材料采购合同' : shellState.value === 'forbidden' ? '无权查看该材料采购合同' : shellState.value === 'not-found' ? '未找到材料采购合同' : '材料采购合同读取失败'))

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
    const anchorId = `material-contract-supplier-fact-${row.view}`
    const url = new URL(route.fullPath, 'https://ruihang.invalid')
    url.searchParams.set('supplierFactJourney', supplierFactContextId.value)
    url.hash = anchorId
    const returnTo = validateMaterialContractDetailJourneyReturnTo(
      `${url.pathname}${url.search}${url.hash}`,
      props.origin,
    )
    if (!returnTo)
      return []
    const result = resolveNavigationTarget({
      ...navigation,
      kind: 'entity-subview',
      variant: 'detail',
      view: row.view,
    }, { returnTo })
    return result.state === 'resolved' ? [{ ...row, to: result.to, returnTo, anchorId }] : []
  })
})

function workspaceScrollTop(): number {
  return document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0
}

function captureSupplierFactOrigin(link: typeof supplierFactLinks.value[number]) {
  try {
    saveMaterialContractJourneyReturnOrigin(createMaterialContractJourneyReturnOrigin({
      contextId: supplierFactContextId.value,
      returnTo: link.returnTo,
      anchorId: link.anchorId,
      scrollTop: workspaceScrollTop(),
      now: Date.now(),
    }))
  }
  catch {
    // 浏览器存储不可用时仍允许导航，返回时按安全锚点降级。
  }
}

async function restoreSupplierFactOrigin(): Promise<boolean> {
  const returnTo = validateMaterialContractDetailJourneyReturnTo(route.fullPath, props.origin)
  if (!returnTo)
    return false
  const url = new URL(returnTo, 'https://ruihang.invalid')
  const anchorId = decodeURIComponent(url.hash.slice(1))
  if (!/^material-contract-supplier-fact-(?:contracts|settlements|invoices|payments)$/.test(anchorId))
    return false
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const target = document.getElementById(anchorId)
  if (!target)
    return false
  const origin = resolveMaterialContractJourneyReturnOrigin({
    returnTo,
    contextId: url.searchParams.get('supplierFactJourney'),
    now: Date.now(),
    load: id => loadMaterialContractJourneyReturnOrigin(id),
  })
  const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (origin && workspace)
    workspace.scrollTop = origin.scrollTop
  else
    target.scrollIntoView?.({ block: 'center' })
  target.focus({ preventScroll: true })
  return true
}

const metrics = computed(() => {
  const amounts = detail.value?.contract.amounts
  if (!amounts)
    return []
  const rows: Array<[string, string | null]> = [
    ['合同金额', amounts.contract],
    ['变更后金额', amounts.changed],
    ['累计结算', amounts.settled],
    ['累计收票', amounts.invoiced],
    ['累计支付', amounts.paid],
    ['应付余额', amounts.payable],
  ]
  return rows.map(([label, value]) => ({ label, value: value == null ? '待核实' : yuan(Number(value)) }))
})

async function load() {
  await store.loadDetail({
    id: props.contractId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
    ...(typeof route.query.supplementId === 'string' ? { supplementId: route.query.supplementId } : {}),
  })
  if (store.detailState.kind === 'ready') {
    if (typeof route.query.supplementId === 'string') {
      await nextTick()
      document.getElementById(`material-contract-supplement-${route.query.supplementId}`)?.focus({ preventScroll: true })
      return
    }
    const restored = await restoreSupplierFactOrigin()
    if (!restored) {
      await nextTick()
      document.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
    }
  }
}

function edit() {
  void navigateTo({
    path: `/contract/material/form/${encodeURIComponent(props.contractId)}`,
    query: { origin: 'real', contractKind: 'material', returnTo: route.fullPath },
  })
}

function supplementForm(id?: string) {
  void navigateTo({ path: id ? `/contract/material/form/${encodeURIComponent(id)}` : '/contract/material/form', query: { origin: 'real', returnTo: route.fullPath, ...(id ? {} : { supplement: '1', originalContractId: props.contractId }) } })
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

watch(() => [props.contractId, props.origin, route.query.supplementId], () => void load(), { immediate: true })
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
          <KitStatusTag :tone="contractStatusTone(detail.contract.status)">
            {{ detail.contract.status }}
          </KitStatusTag>
        </template>
      </template>
      <template #actions>
        <button v-if="canEdit" type="button" class="btn-secondary" data-testid="material-contract-edit" @click="edit">
          编辑合同
        </button>
        <button v-if="canEdit" type="button" class="btn-secondary" @click="supplementForm()">
          新增补充协议
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="6">
          <Metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel v-if="detail.contract.financialReadStatus === 'unavailable'" kind="error" title="关联财务来源尚未就绪" description="结算、收票、支付及应付显示待核实，不能作为真实零值使用。" compact />
        <StatePanel
          v-if="state.kind === 'error' || state.kind === 'unavailable'"
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
            :id="link.anchorId"
            :key="link.view"
            :to="link.to"
            class="btn-ghost"
            :aria-label="link.label"
            @click="captureSupplierFactOrigin(link)"
          >
            {{ link.label.replace('查看分供方', '') }}
          </NuxtLink>
        </section>

        <section v-if="activeTab === 'info'" class="panel p-4">
          <SectionHeader title="详细信息" />
          <div class="material-contract-grid mt-3">
            <div class="detail-row">
              <span>所属项目</span><NuxtLink v-if="target(detail.projectNavigation)" :to="target(detail.projectNavigation)!" class="text-brand hover:underline">
                {{ materialContractReferenceLabel(detail.contract.project) }}
              </NuxtLink><strong v-else>{{ materialContractReferenceLabel(detail.contract.project) }}</strong>
            </div>
            <div class="detail-row">
              <span>分供方</span><NuxtLink v-if="target(detail.supplierNavigation)" :to="target(detail.supplierNavigation)!" class="text-brand hover:underline">
                {{ materialContractReferenceLabel(detail.contract.supplier) }}
              </NuxtLink><strong v-else>{{ materialContractReferenceLabel(detail.contract.supplier) }}</strong>
            </div>
            <div class="detail-row">
              <span>签约日期</span><strong>{{ detail.contract.signDate || '—' }}</strong>
            </div>
            <div class="detail-row">
              <span>甲方（我方签约快照）</span><strong>{{ detail.contract.ourSignatorySnapshot?.name ?? '未核实' }}<small v-if="detail.contract.ourSignatorySnapshot" class="ml-2 font-400 text-ink-soft">核实版本 {{ detail.contract.ourSignatorySnapshot.version }}</small></strong>
            </div>
            <div v-if="detail.contract.legacyPartyA" class="detail-row">
              <span>历史主体原文</span><strong>{{ detail.contract.legacyPartyA }}</strong>
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
          <ContractOriginalFilesPanel :owner-id="detail.contract.id" :origin="detail.dataOrigin" :source-version="detail.sourceVersion" :can-read="canReadOriginals" :files="ownerFiles(detail.contract.id)" :read-content="repository.fileContent" />
        </section>

        <section v-else-if="activeTab === 'lines'" class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader title="采购明细" />
          <div class="material-fact-scroll mt-3" data-testid="material-contract-lines-scroll">
            <table v-if="detail.sections.lineItems.length" class="material-fact-table">
              <thead>
                <tr>
                  <th>物资名称</th><th>规格</th><th>材质</th><th>品牌</th><th>单位</th><th class="text-right">
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
                  <td>{{ row.materialName }}</td><td>{{ row.spec || '—' }}</td><td>{{ row.materialGrade || '未记录' }}</td><td>{{ row.brand || '—' }}</td><td>{{ row.unit || '—' }}</td><td class="text-right">
                    {{ row.qty ?? '—' }}
                  </td><td class="text-right">
                    {{ row.unitPrice == null ? '—' : yuan(Number(row.unitPrice)) }}
                  </td><td class="text-right">
                    {{ row.amount == null ? '—' : yuan(Number(row.amount)) }}
                  </td><td>{{ row.plannedArrivalDate || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <table v-if="detail.sections.deductions?.length" class="material-fact-table mt-3" aria-label="合同优惠与扣减">
              <thead><tr><th>减项名称</th><th>扣减金额</th><th>依据</th></tr></thead><tbody>
                <tr v-for="row in detail.sections.deductions" :key="row.id">
                  <td>{{ row.name }}</td><td>{{ row.amount == null ? '待填' : yuan(Number(row.amount)) }}</td><td>{{ row.basis }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="p-8 text-center text-13px text-ink-soft">
              暂无采购明细
            </p>
          </div>
        </section>

        <section v-else-if="activeTab === 'supplements'" class="space-y-3" aria-label="材料补充协议">
          <article v-for="supplement in detail.sections.supplements ?? []" :id="`material-contract-supplement-${supplement.id}`" :key="supplement.id" tabindex="-1" class="panel min-w-0 overflow-hidden p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="mr-auto text-14px font-700">
                {{ supplement.name }} · {{ supplement.no || '编号未填写' }}
              </h2><span>{{ supplement.amount == null ? '增额未记录' : `本次增额 ${yuan(Number(supplement.amount))}` }}</span><button v-if="canEdit" type="button" class="btn-secondary" @click="supplementForm(supplement.id)">
                编辑协议
              </button>
            </div>
            <p class="mt-2 text-12px">
              {{ supplement.signDate || '日期未记录' }} · {{ supplement.status }} · {{ supplement.content }}
            </p>
            <p class="mt-2 text-12px">
              协议我方签约快照：{{ supplement.ourSignatorySnapshot?.name ?? '历史未核实' }}<span v-if="supplement.ourSignatorySnapshot"> · 核实版本 {{ supplement.ourSignatorySnapshot.version }}</span>
            </p>
            <div class="material-fact-scroll mt-3">
              <table class="material-fact-table">
                <thead><tr><th>材料</th><th>规格</th><th>材质</th><th>单位</th><th>数量</th><th>实际含税单价</th><th>本次增额</th><th>原行身份</th><th>依据</th></tr></thead><tbody>
                  <tr v-for="row in supplement.lineItems" :key="row.id">
                    <td>{{ row.materialName }}</td><td>{{ row.spec }}</td><td>{{ row.materialGrade || '未记录' }}</td><td>{{ row.unit }}</td><td>{{ row.qty ?? '—' }}</td><td>{{ row.unitPrice == null ? '—' : yuan(Number(row.unitPrice)) }}</td><td>{{ row.amount == null ? '待核实' : yuan(Number(row.amount)) }}</td><td>{{ row.originalLineId ?? '新增材料' }}</td><td>{{ row.changeBasis || row.note }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-for="row in supplement.deductions" :key="row.id" class="mt-2 text-12px">
              {{ row.name }}：{{ row.amount == null ? '待填' : yuan(Number(row.amount)) }}；{{ row.basis }}
            </p>
            <p v-for="snapshot in supplement.originalLineSnapshots ?? []" :key="snapshot.originalLineId" class="mt-2 text-12px text-ink-soft">
              原签约依据（{{ snapshot.parentVersion == null ? `来源更新于 ${snapshot.sourceUpdatedAt}` : `版本 ${snapshot.parentVersion}` }}）：{{ snapshot.materialName }} · {{ snapshot.qty ?? '未知数量' }} · {{ snapshot.unitPrice == null ? '未知单价' : yuan(Number(snapshot.unitPrice)) }} · {{ snapshot.originalLineId }}
            </p>
            <ContractOriginalFilesPanel :owner-id="supplement.id" :origin="detail.dataOrigin" :source-version="detail.sourceVersion" :can-read="canReadOriginals" :files="ownerFiles(supplement.id)" :read-content="repository.fileContent" />
          </article>
          <p v-if="!detail.sections.supplements?.length" class="panel p-8 text-center text-13px text-ink-soft">
            暂无材料补充协议
          </p>
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
          正在刷新…
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
