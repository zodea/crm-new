<script setup lang="ts">
import type { F2FormKind } from '~/lib/contract/forms'
// 通用合同详情（#90 批A 底座件④）：1 个页面吃施工/分包/材采三类。
// kind 决定显隐：摘要六指标四级对账口径（施工=开票/收款/应收，支出侧=收票/支付/应付）、
// 变洽签 Tab 仅施工/分包、基本信息里 甲方(项目 developer)/乙方(分供方蓝链)。
// 关联单据 Tab 为壳占位（空表，真聚合停第二趟）；无审批流，只留合同状态 chip。
import type { KitTableColumn } from '~/lib/kit/table'
import type { StatusTone } from '~/lib/project/status'
import { formPath } from '~/lib/contract/page'
import { CONTRACT_STATUS_TONE, contractBalance, kindLabels } from '~/lib/contract/status'
import { yuan } from '~/lib/util/money'

const route = useRoute()
const store = useContractStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()

const contractId = computed(() => route.params.id as string)
const contract = computed(() => store.byId(contractId.value))
const project = computed(() => contract.value ? projectStore.byId(contract.value.projectId) : undefined)
const supplier = computed(() => contract.value?.supplierId ? supplierStore.byId(contract.value.supplierId) : undefined)

// 页签标题回填为合同名
useTabTitle(() => contract.value?.name)

const isCon = computed(() => contract.value?.kind === '施工')
const labels = computed(() => kindLabels(contract.value?.kind ?? '施工'))
const balance = computed(() => contract.value ? contractBalance(contract.value) : 0)

const kindLabel = computed(() => {
  const c = contract.value
  if (!c)
    return ''
  if (c.kind === '施工')
    return '施工合同'
  if (c.kind === '分包')
    return `分包合同${c.subKind ? ` · ${c.subKind}` : ''}`
  return '材料采购合同'
})

/** 返回入口：按 kind 回对应列表页 */
const backTo = computed(() => {
  switch (contract.value?.kind) {
    case '分包': return '/contract/subcontract'
    case '材采': return '/contract/material'
    default: return '/contract/construction'
  }
})

// 语义色调 → chip class（与项目详情同款映射）
const TONE_CHIP: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  muted: 'chip bg-surface-3 text-ink-faint',
  ok: 'chip-ok',
}
const statusChip = computed(() => {
  const tone = CONTRACT_STATUS_TONE[contract.value?.status ?? '']
  return tone ? TONE_CHIP[tone] : 'chip-brand'
})

// ── 摘要六指标（四级对账链 + 派生余额） ──
const metrics = computed(() => {
  const c = contract.value
  if (!c)
    return []
  return [
    { label: '含税合同金额', value: yuan(c.amount), formula: '签订时含税合价' },
    { label: '变更后合同金额', value: yuan(c.changed), formula: '合同金额 + Σ 变洽签审定额', tone: 'brand' as const },
    { label: '累计结算', value: yuan(c.settled), formula: isCon.value ? 'Σ 报量/进度结算' : 'Σ 结算单金额' },
    { label: labels.value.invoiced, value: yuan(c.invoiced), formula: isCon.value ? 'Σ 我方开出发票' : 'Σ 收到发票价税合计' },
    { label: labels.value.paid, value: yuan(c.paid), formula: isCon.value ? 'Σ 甲方回款' : 'Σ 实际支付', tone: isCon.value ? 'ok' as const : 'danger' as const },
    { label: labels.value.balance, value: yuan(balance.value), formula: `累计结算 − ${labels.value.paid}`, tone: balance.value > 0 ? 'danger' as const : 'ok' as const, big: true },
  ]
})

// ── 关联单据 Tab（壳占位：变洽签仅施工/分包，材采无） ──
const activeTab = shallowRef('info')
const tabs = computed(() => {
  const c = contract.value
  if (!c)
    return []
  const out: { key: string, label: string }[] = [{ key: 'info', label: '基本信息' }]
  if (c.kind !== '材采')
    out.push({ key: 'changes', label: isCon.value ? '甲方变洽签' : '分包变洽签' })
  out.push(
    { key: 'settle', label: isCon.value ? '报量 · 进度结算' : '结算' },
    { key: 'invoice', label: isCon.value ? '开票记录' : '收票登记' },
    { key: 'pay', label: isCon.value ? '收款记录' : '付款记录' },
  )
  return out
})

// 占位空表数据：稳定引用，避免每次渲染塞新数组给 vxe
const EMPTY_ROWS: Record<string, unknown>[] = []

const changeColumns = computed<KitTableColumn[]>(() => [
  { title: '#', type: 'seq' },
  { field: 'no', title: '变更编号', width: 110 },
  { field: 'name', title: '变更名称', minWidth: 220 },
  { field: 'inc', title: '含税审定金额', type: 'money', width: 140 },
  { field: 'exc', title: '无税审定金额', type: 'money', width: 140 },
  { field: 'date', title: '审定日期', type: 'date' },
  { field: 'status', title: '状态', width: 90 },
])
const settleColumns = computed<KitTableColumn[]>(() => [
  { title: '#', type: 'seq' },
  { field: 'no', title: '结算编号', width: 120 },
  { field: 'period', title: '期数', width: 90 },
  { field: 'amount', title: '结算金额', type: 'money', width: 140 },
  { field: 'date', title: '结算日期', type: 'date' },
  { field: 'status', title: '状态', width: 90 },
])
const invoiceColumns = computed<KitTableColumn[]>(() => [
  { title: '#', type: 'seq' },
  { field: 'no', title: '发票号码', width: 170 },
  { field: 'type', title: '发票类型', width: 140 },
  { field: 'amount', title: '价税合计', type: 'money', width: 140 },
  { field: 'tax', title: '税额', type: 'money', width: 120 },
  { field: 'date', title: '开票日期', type: 'date' },
])
const payColumns = computed<KitTableColumn[]>(() => [
  { title: '#', type: 'seq' },
  { field: 'no', title: isCon.value ? '收款单号' : '付款单号', width: 130 },
  { field: 'amount', title: isCon.value ? '收款金额' : '支付金额', type: 'money', width: 140 },
  { field: 'method', title: '支付方式', width: 100 },
  { field: 'payer', title: isCon.value ? '付款方（甲方）' : '付款方（我方）', minWidth: 220 },
  { field: 'date', title: isCon.value ? '收款日期' : '支付日期', type: 'date' },
])

function openEdit() {
  if (!contract.value)
    return
  const kinds: Record<typeof contract.value.kind, F2FormKind> = {
    施工: 'construction',
    分包: 'subcontract',
    材采: 'material',
  }
  void navigateTo(formPath(kinds[contract.value.kind], contract.value.id))
}

onMounted(() => {
  store.load()
  projectStore.load()
  supplierStore.load()
})
</script>

<template>
  <div v-if="contract" class="contract-detail-screen">
    <!-- 顶栏 -->
    <div class="border border-line bg-panel mb-3 px-4 py-3">
      <div class="flex flex-wrap items-center gap-3">
        <NuxtLink :to="backTo" class="icon-btn" title="返回列表">
          <span class="i-lucide-arrow-left text-14px" />
        </NuxtLink>
        <h2 class="min-w-0 flex-[1_1_20rem] break-words text-17px font-800 text-ink">
          {{ contract.name }}
        </h2>
        <span class="text-13px text-ink-faint font-mono">{{ contract.no }}</span>
        <span class="text-13px text-ink-faint">{{ kindLabel }}</span>
        <span class="chip" :class="statusChip">{{ contract.status }}</span>
        <button class="btn-secondary ml-auto" @click="openEdit">
          <span class="i-lucide-square-pen text-13px mr-1" /> 编辑
        </button>
      </div>
    </div>

    <!-- 摘要六指标（四级对账） -->
    <div class="mb-3">
      <MetricGrid :cols="6">
        <Metric
          v-for="m in metrics"
          :key="m.label"
          :label="m.label"
          :value="m.value"
          :formula="m.formula"
          :tone="m.tone"
          :big="m.big"
        />
      </MetricGrid>
    </div>

    <!-- Tab 栏 -->
    <div class="mb-3">
      <SegTab v-model="activeTab" :tabs="tabs" />
    </div>

    <!-- 基本信息 -->
    <div v-if="activeTab === 'info'" class="border border-line bg-panel px-4 py-3">
      <div class="contract-detail-grid grid gap-x-7">
        <div class="detail-row">
          <span class="detail-label">合同编号</span>
          <span class="detail-value font-mono">{{ contract.no || '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">合同类别</span>
          <span class="detail-value">{{ kindLabel }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">所属项目</span>
          <span class="detail-value">
            <NuxtLink :to="`/project/${contract.projectId}`" class="cell--link">
              {{ project?.name ?? contract.projectId }}
            </NuxtLink>
          </span>
        </div>
        <div v-if="isCon" class="detail-row">
          <span class="detail-label">甲方（客户）</span>
          <span class="detail-value">{{ project?.developer || '—' }}</span>
        </div>
        <div v-else class="detail-row">
          <span class="detail-label">乙方（分供方）</span>
          <span class="detail-value">
            <NuxtLink v-if="contract.supplierId" :to="`/base/supplier/${contract.supplierId}`" class="cell--link">
              {{ supplier?.name ?? contract.supplierId }}
            </NuxtLink>
            <template v-else>—</template>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">签约日期</span>
          <span class="detail-value font-mono">{{ contract.signDate || '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">合同状态</span>
          <span class="detail-value"><span class="chip" :class="statusChip">{{ contract.status }}</span></span>
        </div>
        <div class="detail-row contract-detail-grid__full">
          <span class="detail-label">备注</span>
          <span class="detail-value">{{ contract.note || '—' }}</span>
        </div>
      </div>
    </div>

    <!-- 关联单据壳占位（真聚合停第二趟，#87 决策4） -->
    <KitTable
      v-else-if="activeTab === 'changes'"
      :columns="changeColumns"
      :data="EMPTY_ROWS"
      :min-rows="5"
      empty="暂无变洽签"
    />
    <KitTable
      v-else-if="activeTab === 'settle'"
      :columns="settleColumns"
      :data="EMPTY_ROWS"
      :min-rows="5"
      empty="暂无结算记录"
    />
    <KitTable
      v-else-if="activeTab === 'invoice'"
      :columns="invoiceColumns"
      :data="EMPTY_ROWS"
      :min-rows="5"
      :empty="isCon ? '暂无开票记录' : '暂无收票记录'"
    />
    <KitTable
      v-else-if="activeTab === 'pay'"
      :columns="payColumns"
      :data="EMPTY_ROWS"
      :min-rows="5"
      :empty="isCon ? '暂无收款记录' : '暂无付款记录'"
    />
  </div>

  <div v-else-if="store.loading" class="py-12 text-center text-ink-faint">
    加载中...
  </div>
  <div v-else class="border border-line bg-panel p-6 text-13px text-ink-soft">
    未找到该合同（可能已被删除）。
    <NuxtLink to="/contract/construction" class="cell--link ml-2">
      返回施工合同列表
    </NuxtLink>
  </div>
</template>

<style scoped>
.contract-detail-screen {
  container-type: inline-size;
}
.contract-detail-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
}
.contract-detail-grid__full {
  grid-column: 1 / -1;
}
.detail-row {
  display: flex;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 13px;
  min-width: 0;
}
.detail-label {
  width: 96px;
  flex: none;
  color: var(--ink-soft);
}
.detail-value {
  min-width: 0;
  font-weight: 600;
}
</style>
