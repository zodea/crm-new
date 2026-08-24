<script setup lang="ts">
import type { F2FormKind } from '~/lib/contract/forms'
import type { StatusTone } from '~/lib/project/status'
import type { DataOriginDTO } from '~/types/read-model'
import { useProjectSupplierReturnContext } from '~/composables/useProjectSupplierReturnContext'
import { contractStages } from '~/lib/contract/detail'
import { formPath } from '~/lib/contract/page'
import {
  CONTRACT_STATUS_TONE,
  contractBalance,
  kindLabels,
} from '~/lib/contract/status'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { yuan } from '~/lib/util/money'
import { maskPhone } from '~/lib/util/privacy'
import { isDataOriginDTO } from '~/types/read-model'

const route = useRoute()
const desktop = isDesktopRuntime()
const centralOrigin = computed<DataOriginDTO | null>(() => !desktop && route.query.contractKind === 'material' && isDataOriginDTO(route.query.origin)
  ? route.query.origin
  : null)
const contractStore = useContractStore()
const detailStore = useContractDetailStore()

const contractId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] ?? '' : String(value ?? '')
})
const contract = computed(() => contractStore.byId(contractId.value))
const projectSupplierReturn = useProjectSupplierReturnContext(
  () => contract.value?.projectId,
  () => contract.value?.supplierId,
)
const detail = computed(() => detailStore.byContract(contractId.value))
const initializing = shallowRef(true)
const loadError = shallowRef('')

useTabTitle(() => contract.value?.name)

const isConstruction = computed(() => contract.value?.kind === '施工')
const labels = computed(() => kindLabels(contract.value?.kind ?? '施工'))
const balance = computed(() => contract.value ? contractBalance(contract.value) : 0)
const stages = computed(() => contractStages(contract.value?.status ?? '草稿'))

const kindLabel = computed(() => {
  const current = contract.value
  if (!current)
    return ''
  if (current.kind === '施工')
    return '施工合同'
  if (current.kind === '分包')
    return `分包合同${current.subKind ? ` · ${current.subKind}` : ''}`
  return '材料采购合同'
})

const backTo = computed(() => {
  if (projectSupplierReturn.value)
    return projectSupplierReturn.value.to
  switch (contract.value?.kind) {
    case '分包': return '/contract/subcontract'
    case '材采': return '/contract/material'
    default: return '/contract/construction'
  }
})
const backLabel = computed(() => projectSupplierReturn.value ? '返回项目分供方工作台' : `返回${kindLabel.value}列表`)

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

const metrics = computed(() => {
  const current = contract.value
  if (!current)
    return []
  return [
    { label: '含税合同金额', value: yuan(current.amount), formula: '合同头保存的含税合价' },
    {
      label: '变更后合同金额',
      value: yuan(current.changed),
      formula: isConstruction.value ? '合同金额 + 有效增补 + 已审定变洽签' : '合同金额 + 有效增补',
      tone: 'brand' as const,
    },
    {
      label: '累计结算',
      value: yuan(current.settled),
      formula: isConstruction.value ? 'Σ 非草稿甲方报量' : 'Σ 非草稿支出结算',
    },
    {
      label: labels.value.invoiced,
      value: yuan(current.invoiced),
      formula: isConstruction.value ? 'Σ 非草稿开票申请' : 'Σ 已归档收票',
    },
    {
      label: labels.value.paid,
      value: yuan(current.paid),
      formula: isConstruction.value ? 'Σ 非草稿收款登记' : 'Σ 已确认支付分摊',
      tone: isConstruction.value ? 'ok' as const : 'danger' as const,
    },
    {
      label: labels.value.balance,
      value: yuan(balance.value),
      formula: `累计结算 − ${labels.value.paid}`,
      tone: balance.value > 0 ? 'danger' as const : 'ok' as const,
      big: true,
    },
  ]
})

const activeTab = shallowRef('info')
const tabs = computed(() => {
  const rows = [
    { key: 'info', label: '基本信息' },
    { key: 'documents', label: `关联单据 ${detail.value?.documents.length ?? 0}` },
  ]
  if (contract.value?.kind === '材采')
    rows.push({ key: 'lines', label: `采购明细 ${detail.value?.lineItems.length ?? 0}` })
  rows.push({ key: 'files', label: `合同文件 ${detail.value?.files.length ?? 0}` })
  return rows
})

watch(tabs, (nextTabs) => {
  if (!nextTabs.some(tab => tab.key === activeTab.value))
    activeTab.value = 'info'
})

function openEdit() {
  const current = contract.value
  if (!current)
    return
  const kinds: Record<typeof current.kind, F2FormKind> = {
    施工: 'construction',
    分包: 'subcontract',
    材采: 'material',
  }
  void navigateTo(formPath(kinds[current.kind], current.id))
}

let loadRequest = 0

async function load() {
  if (centralOrigin.value)
    return
  const request = ++loadRequest
  const requestedId = contractId.value
  initializing.value = true
  loadError.value = ''
  detailStore.clear(requestedId)
  try {
    await contractStore.load()
    if (request !== loadRequest)
      return
    const current = contractStore.byId(requestedId)
    if (current)
      await detailStore.load(current.id, current.kind)
  }
  catch (cause) {
    if (request !== loadRequest)
      return
    loadError.value = cause instanceof Error ? cause.message : '合同详情读取失败'
  }
  finally {
    if (request === loadRequest)
      initializing.value = false
  }
}

watch(contractId, () => {
  activeTab.value = 'info'
  void load()
}, { immediate: true })
</script>

<template>
  <MaterialContractDetailScreen
    v-if="centralOrigin"
    :contract-id="contractId"
    :origin="centralOrigin"
  />
  <div
    v-else-if="contract && !initializing && !contractStore.loading && !loadError"
    class="contract-detail-screen min-w-0 space-y-3"
  >
    <header class="panel px-4 py-3" data-ui="contract-detail-header">
      <div class="flex min-w-0 flex-wrap items-center gap-3">
        <NuxtLink :to="backTo" class="icon-btn" :aria-label="backLabel" :title="backLabel">
          <span class="i-lucide-arrow-left h-3.5 w-3.5" aria-hidden="true" />
        </NuxtLink>
        <div class="min-w-0 flex-[1_1_24rem]">
          <h1 class="break-words text-18px font-850 text-ink" :title="contract.name">
            {{ contract.name }}
          </h1>
          <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-12px text-ink-soft">
            <span class="break-all font-mono" :title="contract.no">{{ contract.no || '编号未填写' }}</span>
            <span>{{ kindLabel }}</span>
            <span class="chip" :class="statusChip">{{ contract.status }}</span>
          </div>
        </div>
        <button type="button" class="btn-secondary ml-auto" @click="openEdit">
          <span class="i-lucide-square-pen mr-1 h-3.5 w-3.5" aria-hidden="true" />
          编辑合同
        </button>
      </div>
    </header>

    <MetricGrid :cols="6">
      <Metric
        v-for="metric in metrics"
        :key="metric.label"
        :label="metric.label"
        :value="metric.value"
        :formula="metric.formula"
        :tone="metric.tone"
        :big="metric.big"
      />
    </MetricGrid>

    <ContractLifecycle :stages="stages" />

    <div class="panel px-3">
      <SegTab v-model="activeTab" :tabs="tabs" />
    </div>

    <section v-if="activeTab === 'info'" class="panel p-4" aria-labelledby="contract-info-title">
      <SectionHeader
        id="contract-info-title"
        title="基本信息"
        subtitle="三类合同共用合同头，合同类型专有字段按实际值展示"
      />
      <div class="contract-detail-grid mt-3 grid gap-x-7">
        <div class="detail-row">
          <span class="detail-label">合同编号</span>
          <span class="detail-value break-all font-mono">{{ contract.no || '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">合同类别</span>
          <span class="detail-value">{{ kindLabel }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">所属项目</span>
          <span class="detail-value min-w-0">
            <NuxtLink
              :to="`/project/${contract.projectId}`"
              class="block truncate text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
              :title="contract.projectName || contract.projectId"
            >
              {{ contract.projectName || contract.projectId }}
            </NuxtLink>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ labels.party }}</span>
          <span class="detail-value min-w-0">
            <NuxtLink
              v-if="isConstruction && contract.customerId"
              :to="`/base/customer/${contract.customerId}`"
              class="block truncate text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
              :title="contract.customerName"
            >
              {{ contract.customerName || '—' }}
            </NuxtLink>
            <NuxtLink
              v-else-if="!isConstruction && contract.supplierId"
              :to="`/base/supplier/${contract.supplierId}`"
              class="block truncate text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
              :title="contract.supplierName"
            >
              {{ contract.supplierName || '—' }}
            </NuxtLink>
            <template v-else>—</template>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">签约日期</span>
          <span class="detail-value font-mono">{{ contract.signDate || '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">发票类型</span>
          <span class="detail-value">{{ contract.invoiceType || '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">履约联系人</span>
          <span class="detail-value">{{ contract.contactName || '—' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">联系电话</span>
          <span class="detail-value font-mono">{{ maskPhone(contract.contactPhone) || '—' }}</span>
        </div>
        <div class="detail-row contract-detail-grid__full">
          <span class="detail-label">合同内容</span>
          <span class="detail-value whitespace-pre-wrap">{{ contract.content || '—' }}</span>
        </div>
        <div class="detail-row contract-detail-grid__full">
          <span class="detail-label">主要条款</span>
          <span class="detail-value whitespace-pre-wrap">{{ contract.mainTerms || '—' }}</span>
        </div>
        <div class="detail-row contract-detail-grid__full">
          <span class="detail-label">备注</span>
          <span class="detail-value whitespace-pre-wrap">{{ contract.note || '—' }}</span>
        </div>
      </div>
    </section>

    <ContractDetailDocuments
      v-else-if="activeTab === 'documents'"
      :rows="detail?.documents ?? []"
    />
    <ContractDetailLineItems
      v-else-if="activeTab === 'lines'"
      :rows="detail?.lineItems ?? []"
    />
    <ContractDetailFiles
      v-else-if="activeTab === 'files'"
      :files="detail?.files ?? []"
    />
  </div>

  <StatePanel
    v-else-if="initializing || contractStore.loading"
    kind="loading"
    title="正在读取合同详情"
    description="正在汇总合同、票款、结算与文件关系。"
  />
  <StatePanel
    v-else-if="loadError"
    kind="error"
    title="合同详情读取失败"
    :description="loadError"
    action-label="重新加载"
    @action="load"
  />
  <StatePanel
    v-else
    kind="empty"
    title="未找到该合同"
    description="该合同可能已删除，或其所属项目、客户、分供方已不可见。"
  >
    <template #action>
      <NuxtLink to="/contract/construction" class="btn-secondary">
        返回施工合同列表
      </NuxtLink>
    </template>
  </StatePanel>
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
  min-width: 0;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 13px;
}

.detail-label {
  width: 104px;
  flex: none;
  color: var(--ink-soft);
}

.detail-value {
  min-width: 0;
  font-weight: 600;
}
</style>
