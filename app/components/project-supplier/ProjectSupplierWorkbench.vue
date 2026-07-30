<script setup lang="ts">
import type {
  ProjectSupplierWorkbenchFacts,
  ProjectSupplierWorkbenchTab,
} from '~/lib/project-supplier/workbench'
import { db } from '~/lib/db/client'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import {
  confirmProjectSupplierSettlement,
  loadProjectSupplierWorkbench,
  projectSupplierWorkbenchTab,
} from '~/lib/project-supplier/workbench'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  projectId: string
  supplierId: string
}>()

const projectSupplierStore = useProjectSupplierStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const route = useRoute()
const router = useRouter()
const { error, success } = useKitUI()

const project = computed(() => projectStore.byId(props.projectId))
const supplier = computed(() => supplierStore.byId(props.supplierId))
const relation = computed(() =>
  projectSupplierStore.byProjectAndSupplier(props.projectId, props.supplierId),
)

useTabTitle(() => supplier.value?.name)

const STATUS_LABEL: Record<string, string> = {
  collecting: '资料收集中',
  contracted: '已签合同',
  claiming: '请款中',
  paid: '已付款',
  settled: '已结算',
}
const STATUS_COLOR: Record<string, string> = {
  collecting: 'chip-warn',
  contracted: 'chip-brand',
  claiming: 'chip-brand',
  paid: 'chip-ok',
  settled: 'chip-ok',
}
const STATUS_DEFAULT_TAB: Record<string, ProjectSupplierWorkbenchTab> = {
  collecting: 'contract',
  contracted: 'claim',
  claiming: 'claim',
  paid: 'payment',
  settled: 'settlement',
}

const activeTab = shallowRef(projectSupplierWorkbenchTab(route.query.tab) ?? 'overview')
const facts = shallowRef<ProjectSupplierWorkbenchFacts | null>(null)
const loading = shallowRef(false)
const loadError = shallowRef('')
const showSettlement = shallowRef(false)
const settlementAmount = shallowRef<number | null>(null)
const settlementDate = shallowRef(new Date().toISOString().slice(0, 10))
const settlementNote = shallowRef('')
const settlementPdf = shallowRef<Awaited<ReturnType<typeof fileRefDraftFromFile>> | null>(null)
const settlementBusy = shallowRef(false)

const counts = computed(() => ({
  overview: 0,
  contract: facts.value?.contracts.length ?? 0,
  claim: facts.value?.claims.length ?? 0,
  ticket: facts.value?.invoices.length ?? 0,
  payment: facts.value?.payments.length ?? 0,
  settlement: facts.value?.settlements.length ?? 0,
}))
const tabs = computed(() => [
  { key: 'overview', label: '合作概览' },
  { key: 'contract', label: '合同', count: counts.value.contract },
  { key: 'claim', label: '请款', count: counts.value.claim },
  { key: 'ticket', label: '收票', count: counts.value.ticket },
  { key: 'payment', label: '付款', count: counts.value.payment },
  { key: 'settlement', label: '结算', count: counts.value.settlement },
])

const summaryCards = computed(() => {
  const value = facts.value?.summary
  return [
    { label: '变更后合同额', value: value?.contractTotal, hint: '非草稿支出合同' },
    { label: '已审批请款', value: value?.claimedTotal, hint: '审批金额口径' },
    { label: '已归档收票', value: value?.invoiceTotal, hint: '含税金额' },
    { label: '已确认支付', value: value?.paidTotal, hint: '银行支付事实' },
    { label: '应付余额', value: value?.balance, hint: '合同额 − 已确认支付', accent: true },
  ]
})

const metricsNote = computed(() => {
  const value = facts.value?.summary
  if (!value)
    return '正在读取权威业务表'
  return `收票税额 ${yuan(value.taxTotal)} · 已确认结算 ${yuan(value.settlementTotal)}`
})

const query = computed(() => ({
  projectId: props.projectId,
  supplierId: props.supplierId,
  returnTo: `/project/${props.projectId}/supplier/${props.supplierId}`,
}))

function date(value: string): string {
  return value || '—'
}

const contractRows = computed(() => (facts.value?.contracts ?? []).map(row => ({
  id: row.id,
  sourcePath: row.sourcePath,
  cells: [
    { text: row.no, tone: 'muted' as const },
    { text: row.name },
    { text: row.kind },
    { text: yuan(row.amount), tone: 'money' as const },
    { text: yuan(row.changedAmount), tone: 'money' as const },
    { text: date(row.signDate), tone: 'muted' as const },
    { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
    { text: row.status, tone: 'status' as const },
  ],
})))
const claimRows = computed(() => (facts.value?.claims ?? []).map(row => ({
  id: row.id,
  sourcePath: row.sourcePath,
  cells: [
    { text: row.no, tone: 'muted' as const },
    { text: row.name },
    { text: yuan(row.applyAmount), tone: 'money' as const },
    { text: yuan(row.approvedAmount), tone: 'money' as const },
    { text: date(row.applyDate), tone: 'muted' as const },
    { text: row.invoiceState },
    { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
    { text: row.status, tone: 'status' as const },
  ],
})))
const invoiceRows = computed(() => (facts.value?.invoices ?? []).map(row => ({
  id: row.id,
  sourcePath: row.sourcePath,
  cells: [
    { text: row.invoiceNumber, tone: 'muted' as const },
    { text: date(row.invoiceDate), tone: 'muted' as const },
    { text: row.invoiceType },
    { text: yuan(row.totalAmount), tone: 'money' as const },
    { text: yuan(row.taxAmount), tone: 'money' as const },
    { text: row.fileName, tone: 'muted' as const },
    { text: row.accountStatus, tone: 'status' as const },
  ],
})))
const paymentRows = computed(() => (facts.value?.payments ?? []).map(row => ({
  id: row.id,
  sourcePath: row.sourcePath,
  cells: [
    { text: row.no, tone: 'muted' as const },
    { text: date(row.paymentDate), tone: 'muted' as const },
    { text: yuan(row.amount), tone: 'money' as const },
    { text: row.paymentMethod },
    { text: row.voucherNo, tone: 'muted' as const },
    { text: row.applicationNos, tone: 'muted' as const },
    { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
    { text: row.status, tone: 'status' as const },
  ],
})))
const settlementRows = computed(() => (facts.value?.settlements ?? []).map(row => ({
  id: row.id,
  sourcePath: row.sourcePath,
  cells: [
    { text: row.no, tone: 'muted' as const },
    { text: row.name },
    { text: row.settlementType },
    { text: yuan(row.amount), tone: 'money' as const },
    { text: date(row.settlementDate), tone: 'muted' as const },
    { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
    { text: row.status, tone: 'status' as const },
  ],
})))

const recentFacts = computed(() => {
  const rows = [
    ...(facts.value?.contracts ?? []).map(item => ({
      key: `contract-${item.id}`,
      date: item.signDate,
      label: `合同 · ${item.no || item.name}`,
      value: yuan(item.changedAmount),
      path: item.sourcePath,
    })),
    ...(facts.value?.claims ?? []).map(item => ({
      key: `claim-${item.id}`,
      date: item.applyDate,
      label: `请款 · ${item.no || item.name}`,
      value: yuan(item.approvedAmount || item.applyAmount),
      path: item.sourcePath,
    })),
    ...(facts.value?.payments ?? []).map(item => ({
      key: `payment-${item.id}`,
      date: item.paymentDate,
      label: `支付 · ${item.no || item.voucherNo}`,
      value: yuan(item.amount),
      path: item.sourcePath,
    })),
  ]
  return rows.sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5)
})

const settlementReady = computed(() =>
  relation.value?.status === 'paid'
  && !facts.value?.relationSettlement
  && Boolean(settlementAmount.value && settlementAmount.value > 0)
  && Boolean(settlementDate.value)
  && Boolean(settlementPdf.value),
)
const settlementHint = computed(() => {
  if (relation.value?.status === 'settled')
    return '合作终态结算已确认，不能重复确认；源业务仍在各自模块维护。'
  if (relation.value?.status !== 'paid')
    return '合作状态到达“已付款”后才能确认最终结算。'
  if (facts.value?.relationSettlement)
    return '最终结算记录已存在，不能重复生成。'
  if (!settlementAmount.value)
    return '请填写最终结算金额。'
  if (!settlementPdf.value)
    return '请上传 PDF 格式的结算确认书。'
  return '金额、日期与结算确认书已齐备，可二次确认后进入合作终态。'
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([
      projectStore.load(),
      supplierStore.load(),
      projectSupplierStore.load(),
    ])
    if (!relation.value)
      return
    facts.value = await loadProjectSupplierWorkbench(
      db,
      props.projectId,
      props.supplierId,
      relation.value.id,
    )
  }
  catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : '工作台读取失败'
  }
  finally {
    loading.value = false
  }
}

async function confirmSettlement() {
  if (settlementBusy.value || !relation.value || !settlementReady.value)
    return
  settlementBusy.value = true
  try {
    await confirmProjectSupplierSettlement({
      projectSupplierId: relation.value.id,
      finalAmount: settlementAmount.value!,
      date: settlementDate.value,
      note: settlementNote.value,
      pdf: settlementPdf.value!,
    })
    success('结算已确认', '最终结算记录、确认书与合作终态已同步保存')
    showSettlement.value = false
    await load()
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : '结算确认失败')
  }
  finally {
    settlementBusy.value = false
  }
}

async function selectSettlementPdf(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    settlementPdf.value = null
    return
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    settlementPdf.value = null
    input.value = ''
    error('结算确认书仅支持 PDF 格式')
    return
  }
  const draft = await fileRefDraftFromFile(file, {
    category: '结算确认书',
  })
  settlementPdf.value = {
    ...draft,
    mimeType: 'application/pdf',
  }
}

watch(relation, (value, previous) => {
  if (
    value
    && value.id !== previous?.id
    && !projectSupplierWorkbenchTab(route.query.tab)
  ) {
    activeTab.value = STATUS_DEFAULT_TAB[value.status] || 'overview'
  }
}, { immediate: true })
watch(() => route.query.tab, (value) => {
  const tab = projectSupplierWorkbenchTab(value)
  if (tab && tab !== activeTab.value)
    activeTab.value = tab
})
watch(activeTab, (tab) => {
  if (route.query.tab === tab)
    return
  void router.replace({
    query: {
      ...route.query,
      tab,
    },
  })
})
watch(
  () => [props.projectId, props.supplierId] as const,
  ([projectId, supplierId], [previousProjectId, previousSupplierId]) => {
    if (projectId === previousProjectId && supplierId === previousSupplierId)
      return
    facts.value = null
    loadError.value = ''
    void load()
  },
)

onMounted(() => {
  void load()
})
onActivated(() => {
  void load()
})
</script>

<template>
  <div class="project-supplier-workbench flex min-w-0 flex-col gap-4">
    <header v-if="project && supplier && relation" class="panel min-w-0 overflow-hidden">
      <div class="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
        <NuxtLink :to="`/project/${projectId}`" class="icon-btn" aria-label="返回项目详情">
          <span class="i-lucide-arrow-left text-14px" aria-hidden="true" />
        </NuxtLink>
        <div class="min-w-0 flex-1">
          <p class="text-10px font-700 uppercase tracking-[0.14em] text-ink-faint">
            项目 × 分供方工作台
          </p>
          <h1 class="mt-0.5 break-words text-17px font-800 text-ink">
            {{ project.name }}
            <span class="mx-1.5 text-ink-faint">×</span>
            {{ supplier.name }}
          </h1>
          <p class="mt-1 text-11px text-ink-soft">
            项目业务单据聚合展示 · 新增、编辑和审批均在源模块完成
          </p>
        </div>
        <span class="chip" :class="STATUS_COLOR[relation.status]">
          {{ STATUS_LABEL[relation.status] || relation.status }}
        </span>
        <KitButton variant="secondary" :loading="loading" @click="load">
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />刷新
        </KitButton>
      </div>

      <div class="supplier-summary-grid grid divide-x divide-y divide-line">
        <div v-for="card in summaryCards" :key="card.label" class="min-w-0 px-3 py-2.5">
          <p class="text-9px font-600 text-ink-faint">
            {{ card.label }}
          </p>
          <p
            class="mt-0.5 truncate font-mono text-14px font-800 tabular-nums"
            :class="card.accent ? 'text-danger' : 'text-ink'"
          >
            {{ card.value == null ? '—' : yuan(card.value) }}
          </p>
          <p class="mt-0.5 truncate text-9px text-ink-faint">
            {{ card.hint }}
          </p>
        </div>
      </div>
      <p class="border-t border-line bg-surface-2 px-4 py-1.5 text-10px text-ink-faint">
        {{ metricsNote }}
      </p>
    </header>

    <div v-if="loadError" role="alert" class="panel border-danger/30 bg-danger/5 px-4 py-3 text-12px text-danger">
      {{ loadError }}
      <button type="button" class="ml-2 underline" @click="load">
        重试
      </button>
    </div>

    <template v-if="project && supplier && relation">
      <SegTab v-model="activeTab" :tabs="tabs" />

      <section v-if="activeTab === 'overview'" class="workbench-split grid min-w-0 gap-4">
        <div class="panel min-w-0 p-4">
          <div class="overview-facts-grid grid gap-5">
            <section>
              <h2 class="section-heading mb-3 text-13px font-700 text-ink">
                <span aria-hidden="true" class="h-3.5 w-[3px] rounded-[1px] bg-brand" /> 项目信息
              </h2>
              <dl class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-12px">
                <dt class="text-ink-faint">
                  项目名称
                </dt>
                <dd><EntityLink :id="project.id" type="project" :label="project.name" /></dd>
                <dt class="text-ink-faint">
                  项目状态
                </dt>
                <dd class="text-ink">
                  {{ project.status || '—' }}
                </dd>
                <dt class="text-ink-faint">
                  建设单位
                </dt>
                <dd class="break-words text-ink">
                  {{ project.developer || '—' }}
                </dd>
                <dt class="text-ink-faint">
                  项目经理
                </dt>
                <dd class="text-ink">
                  {{ project.manager || '—' }}
                </dd>
              </dl>
            </section>
            <section>
              <h2 class="section-heading mb-3 text-13px font-700 text-ink">
                <span aria-hidden="true" class="h-3.5 w-[3px] rounded-[1px] bg-brand" /> 分供方信息
              </h2>
              <dl class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-12px">
                <dt class="text-ink-faint">
                  公司名称
                </dt>
                <dd><EntityLink :id="supplier.id" type="supplier" :label="supplier.name" /></dd>
                <dt class="text-ink-faint">
                  类别
                </dt>
                <dd class="text-ink">
                  {{ supplier.supplierCategory || '—' }}
                </dd>
                <dt class="text-ink-faint">
                  联系人
                </dt>
                <dd class="text-ink">
                  {{ supplier.contact || '—' }}
                </dd>
                <dt class="text-ink-faint">
                  联系电话
                </dt>
                <dd class="text-ink">
                  {{ supplier.contactPhone || '—' }}
                </dd>
              </dl>
            </section>
          </div>
          <div class="mt-5 border-t border-line pt-4">
            <h2 class="mb-2 text-12px font-700 text-ink">
              合作备注
            </h2>
            <p class="whitespace-pre-wrap text-12px leading-5 text-ink-soft">
              {{ relation.note || '暂无合作备注' }}
            </p>
          </div>
        </div>

        <aside class="panel min-w-0 overflow-hidden">
          <div class="border-b border-line bg-surface-2 px-3 py-2">
            <h2 class="text-13px font-700 text-ink">
              最近业务动态
            </h2>
          </div>
          <div v-if="recentFacts.length" class="divide-y divide-line">
            <NuxtLink
              v-for="item in recentFacts"
              :key="item.key"
              :to="item.path"
              class="block px-3 py-2.5 hover:bg-surface-2"
            >
              <div class="flex items-start gap-2">
                <span class="min-w-0 flex-1 truncate text-11px font-700 text-ink">{{ item.label }}</span>
                <span class="font-mono text-11px text-ink">{{ item.value }}</span>
              </div>
              <p class="mt-0.5 text-10px text-ink-faint">
                {{ item.date || '未记录日期' }}
              </p>
            </NuxtLink>
          </div>
          <p v-else class="px-4 py-8 text-center text-12px text-ink-faint">
            暂无合同、请款或支付动态
          </p>
        </aside>
      </section>

      <section v-else-if="activeTab === 'contract'" class="panel min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div class="mr-auto">
            <h2 class="text-13px font-700 text-ink">
              关联合同
            </h2>
            <p class="text-10px text-ink-faint">
              共 {{ contractRows.length }} 条 · 点击“查看源单”穿透合同详情
            </p>
          </div>
          <NuxtLink :to="{ path: '/contract/subcontract/form', query }" class="btn-secondary">
            新建分包合同
          </NuxtLink>
          <NuxtLink :to="{ path: '/contract/material/form', query }" class="btn-accent">
            新建材料合同
          </NuxtLink>
        </div>
        <ProjectSupplierFactTable
          :columns="['合同编号', '合同名称', '类别', '合同额', '变更后金额', '签约日期', '附件', '状态']"
          :rows="contractRows"
          empty="暂无关联合同，可前往合同模块新建"
        />
      </section>

      <section v-else-if="activeTab === 'claim'" class="panel min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div class="mr-auto">
            <h2 class="text-13px font-700 text-ink">
              付款申请
            </h2>
            <p class="text-10px text-ink-faint">
              共 {{ claimRows.length }} 条 · 申请与审批均在付款模块完成
            </p>
          </div>
          <NuxtLink :to="{ path: '/finance/payment/new', query }" class="btn-accent">
            新建付款申请
          </NuxtLink>
        </div>
        <ProjectSupplierFactTable
          :columns="['申请编号', '申请名称', '申请金额', '审批金额', '申请日期', '回票类型', '附件', '状态']"
          :rows="claimRows"
          empty="暂无付款申请，可前往付款模块发起"
        />
      </section>

      <section v-else-if="activeTab === 'ticket'" class="panel min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div class="mr-auto">
            <h2 class="text-13px font-700 text-ink">
              收票记录
            </h2>
            <p class="text-10px text-ink-faint">
              共 {{ invoiceRows.length }} 条 · 汇总仅计已归档发票
            </p>
          </div>
          <NuxtLink :to="{ path: '/finance/invoice', query }" class="btn-accent">
            打开收票工作台
          </NuxtLink>
        </div>
        <ProjectSupplierFactTable
          :columns="['发票号码', '开票日期', '发票类型', '含税金额', '税额', '原文件', '归档状态']"
          :rows="invoiceRows"
          empty="暂无收票记录，可前往收票工作台登记"
        />
      </section>

      <section v-else-if="activeTab === 'payment'" class="panel min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div class="mr-auto">
            <h2 class="text-13px font-700 text-ink">
              支付记录
            </h2>
            <p class="text-10px text-ink-faint">
              共 {{ paymentRows.length }} 条 · 汇总仅计银行已确认支付
            </p>
          </div>
          <NuxtLink :to="{ path: '/finance/records/new', query }" class="btn-accent">
            新建支付记录
          </NuxtLink>
        </div>
        <ProjectSupplierFactTable
          :columns="['支付编号', '支付日期', '金额', '方式', '凭证号', '关联申请', '附件', '状态']"
          :rows="paymentRows"
          empty="暂无支付记录，可前往支付模块登记"
        />
      </section>

      <section v-else-if="activeTab === 'settlement'" class="workbench-split grid min-w-0 gap-4">
        <div class="panel min-w-0 overflow-hidden">
          <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <div class="mr-auto">
              <h2 class="text-13px font-700 text-ink">
                支出结算
              </h2>
              <p class="text-10px text-ink-faint">
                共 {{ settlementRows.length }} 条 · 结算编制在对应源模块完成
              </p>
            </div>
          </div>
          <ProjectSupplierFactTable
            :columns="['结算编号', '结算名称', '类型', '含税结算额', '结算日期', '附件', '状态']"
            :rows="settlementRows"
            empty="暂无支出结算记录"
          />
        </div>
        <aside class="panel min-w-0 p-4">
          <h2 class="text-13px font-700 text-ink">
            最终结算确认
          </h2>
          <div v-if="facts?.relationSettlement" class="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-11px">
            <span class="text-ink-faint">最终结算金额</span>
            <span class="font-mono font-700 text-ink">{{ yuan(facts.relationSettlement.finalAmount) }}</span>
            <span class="text-ink-faint">结算日期</span>
            <span class="text-ink">{{ facts.relationSettlement.date || '—' }}</span>
            <span class="text-ink-faint">确认书</span>
            <span class="break-all text-ink">{{ facts.relationSettlement.pdfFileName || '已关联 PDF' }}</span>
          </div>
          <div v-else-if="relation.status === 'paid'" class="mt-3 grid gap-3">
            <label class="grid gap-1 text-11px font-600 text-ink">
              <span>最终结算金额 <span class="text-danger">*</span></span>
              <input
                v-model.number="settlementAmount"
                type="number"
                min="0.01"
                step="0.01"
                class="field-input w-full font-mono"
                placeholder="0.00"
              >
            </label>
            <label class="grid gap-1 text-11px font-600 text-ink">
              <span>结算日期 <span class="text-danger">*</span></span>
              <input v-model="settlementDate" type="date" class="field-input w-full">
            </label>
            <label class="grid gap-1 text-11px font-600 text-ink">
              <span>结算确认书 PDF <span class="text-danger">*</span></span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                class="block w-full text-11px text-ink-soft file:mr-2 file:border-0 file:bg-surface-3 file:px-2 file:py-1.5 file:text-11px file:font-600 file:text-ink"
                @change="selectSettlementPdf"
              >
              <span v-if="settlementPdf" class="truncate text-10px text-ok">
                已选择 {{ settlementPdf.fileName }}
              </span>
            </label>
            <label class="grid gap-1 text-11px font-600 text-ink">
              <span>结算备注</span>
              <textarea
                v-model="settlementNote"
                rows="3"
                class="field-input w-full resize-y"
                placeholder="可选"
              />
            </label>
          </div>
          <p class="mt-3 rounded bg-surface-2 px-3 py-2 text-11px leading-5 text-ink-soft">
            {{ settlementHint }}
          </p>
          <KitButton
            v-if="relation.status !== 'settled'"
            class="mt-3 w-full justify-center"
            :disabled="!settlementReady || settlementBusy"
            :loading="settlementBusy"
            @click="showSettlement = true"
          >
            确认最终结算
          </KitButton>
          <div v-else class="mt-3 flex items-center gap-2 text-12px font-700 text-ok">
            <span class="i-lucide-circle-check text-16px" aria-hidden="true" />
            已确认合作终态
          </div>
        </aside>
      </section>

      <ProjectSupplierFilePanel :files="facts?.files ?? []" />

      <ConfirmDialog
        :open="showSettlement"
        title="确认最终结算"
        message="确认后将新增唯一的终态结算记录，合作关系进入“已结算”；该确认不能重复，源业务仍在各自模块维护。是否继续？"
        confirm-label="确认并进入终态"
        @confirm="confirmSettlement"
        @cancel="showSettlement = false"
      />
    </template>

    <div v-else-if="!loading" class="panel px-4 py-12 text-center">
      <span class="i-lucide-folder-x mx-auto block text-28px text-ink-faint" aria-hidden="true" />
      <p class="mt-2 text-13px font-700 text-ink">
        未找到项目与分供方合作关系
      </p>
      <NuxtLink :to="`/project/${projectId}`" class="mt-3 inline-flex cell--link">
        返回项目详情
      </NuxtLink>
    </div>
    <div v-else class="panel px-4 py-12 text-center text-12px text-ink-faint">
      正在加载合作工作台…
    </div>
  </div>
</template>

<style scoped>
.project-supplier-workbench {
  container-name: project-supplier-workbench;
  container-type: inline-size;
}

.supplier-summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
}

.overview-facts-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
}

.workbench-split {
  grid-template-columns: minmax(0, 1fr);
}

@container project-supplier-workbench (min-width: 68rem) {
  .workbench-split {
    grid-template-columns: minmax(0, 1fr) 22rem;
  }
}
</style>
