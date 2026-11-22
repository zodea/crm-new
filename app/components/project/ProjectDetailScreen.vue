<script setup lang="ts">
import type { OwnerCommercialDocumentListPageDTO } from '~/lib/owner-document/central-repository'
import type { ProjectDetailReadDTO } from '~/lib/project/repository'
import type { Project } from '~/stores/project'
import type { DataOriginDTO, ProblemDTO } from '~/types/read-model'
import { computed, nextTick, onActivated, ref, shallowRef, useTemplateRef, watch } from 'vue'
import ConstructionSpendingPanel from '~/components/contract/ConstructionSpendingPanel.vue'
import ProjectConstructionManagementFees from '~/components/project/ProjectConstructionManagementFees.vue'
import ProjectManagementFees from '~/components/project/ProjectManagementFees.vue'
import ProjectMaterialContractJourney from '~/components/project/ProjectMaterialContractJourney.vue'
import ProjectReturnLink from '~/components/project/ProjectReturnLink.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { resolveCustomerRelationReturnOrigin, validateCustomerDetailReturnTo } from '~/lib/customer/return-context'
import {
  createMaterialContractJourneyReturnOrigin,
  isProjectOwnerDocumentCardAnchor,
  loadMaterialContractJourneyReturnOrigin,
  newMaterialContractReturnContextId,
  resolveMaterialContractJourneyReturnOrigin,
  saveMaterialContractJourneyReturnOrigin,
  validateProjectJourneyReturnTo,
} from '~/lib/material-contract/return-context'
import {
  createOwnerDocumentProjectReturnOrigin,
  loadOwnerDocumentReturnOrigin,
  newOwnerDocumentReturnContextId,
  resolveOwnerDocumentProjectReturnOrigin,
  saveOwnerDocumentReturnOrigin,
} from '~/lib/owner-document/return-context'
import { projectProblem, projectProblemFromUnknown } from '~/lib/project/repository'
import { projectStatusTone } from '~/lib/project/status'
import { loadReceiptSourceOrigin, saveReceiptSourceOrigin } from '~/lib/receipt/return-context'
import { yuan } from '~/lib/util/money'

const props = withDefaults(defineProps<{
  projectId: string
  originHint?: DataOriginDTO
  includeDemo?: boolean
  returnTo?: string
  returnExpiresAt?: number
  returnLabel?: string
  customerReturnTo?: string
  currentRoute?: string
}>(), {
  originHint: 'real',
  includeDemo: false,
  returnTo: '/project',
  currentRoute: '',
})

const repository = useNuxtApp().$repositories.projectList
const commandStore = useProjectCommandStore()
const projectSupplierCommandStore = useProjectSupplierCommandStore()
const detail = shallowRef<ProjectDetailReadDTO | null>(null)
const deleted = shallowRef<boolean | null>(null)
const hasLifecycle = computed(() => detail.value?.capabilities.includes('project:lifecycle:write') === true)
const state = shallowRef<'loading' | 'ready' | 'forbidden' | 'not-found' | 'mismatch' | 'error'>('loading')
const problem = shallowRef<ProblemDTO | null>(null)
const titleRef = useTemplateRef<HTMLHeadingElement>('titleRef')
const materialJourneyContextId = ref(newMaterialContractReturnContextId())
let latestLoad = 0
let hasActivated = false
type OwnerJourneyKind = 'change' | 'report' | 'acceptance' | 'warranty' | 'final-settlement' | 'penalty' | 'sub-change' | 'sub-settlement' | 'project-penalty'
type OwnerJourneyPages = Partial<{
  change: OwnerCommercialDocumentListPageDTO
  report: OwnerCommercialDocumentListPageDTO
  acceptance: OwnerCommercialDocumentListPageDTO
  warranty: OwnerCommercialDocumentListPageDTO
  finalSettlement: OwnerCommercialDocumentListPageDTO
  penalty: OwnerCommercialDocumentListPageDTO
  subChange: OwnerCommercialDocumentListPageDTO
  subSettlement: OwnerCommercialDocumentListPageDTO
  projectPenalty: OwnerCommercialDocumentListPageDTO
}>
interface OwnerJourneyCard { kind: OwnerJourneyKind, label: string, page: OwnerCommercialDocumentListPageDTO }
const ownerJourneys = shallowRef<OwnerJourneyPages | null>(null)
const ownerJourneysError = shallowRef('')

const item = computed(() => detail.value?.item ?? null)
const customerReturnOrigin = computed(() => resolveCustomerRelationReturnOrigin(props.customerReturnTo, { targetEntity: 'project', targetId: props.projectId, origin: props.originHint }))
const verifiedCustomerReturnTo = computed(() => {
  if (!props.customerReturnTo)
    return null
  const hasContext = new URL(props.customerReturnTo, 'https://ruihang.invalid').searchParams.has('relationContext')
  if (hasContext && !customerReturnOrigin.value)
    return null
  if (!item.value)
    return customerReturnOrigin.value?.returnTo ?? null
  const customerIds = [item.value.customer, item.value.secondaryCustomer]
    .filter(reference => reference.state === 'resolved')
    .map(reference => reference.id)
  return customerIds
    .map(customerId => validateCustomerDetailReturnTo(props.customerReturnTo, item.value?.dataOrigin, customerId))
    .find(Boolean) ?? null
})
const effectiveReturnTo = computed(() => verifiedCustomerReturnTo.value ?? props.returnTo)
const effectiveReturnLabel = computed(() => verifiedCustomerReturnTo.value ? '返回客户详情' : props.returnLabel)
const effectiveReturnExpiresAt = computed(() => verifiedCustomerReturnTo.value ? customerReturnOrigin.value?.expiresAt : props.returnExpiresAt)
const project = computed(() => item.value ? projectFromRead(item.value) : null)
const isDemo = computed(() => item.value?.dataOrigin === 'demo')
const journeyReturnTo = computed(() => props.currentRoute
  || `/project/${encodeURIComponent(props.projectId)}?origin=${props.originHint}`)
const materialJourneyReturnTo = computed(() => {
  const url = new URL(journeyReturnTo.value, 'https://ruihang.invalid')
  url.searchParams.set('materialJourney', materialJourneyContextId.value)
  url.hash = 'project-material-contract-link'
  return validateProjectJourneyReturnTo(`${url.pathname}${url.search}${url.hash}`, props.originHint)
    ?? `/project/${encodeURIComponent(props.projectId)}?origin=${props.originHint}`
})
const receiptReturnTo = computed(() => {
  const url = new URL(journeyReturnTo.value, 'https://ruihang.invalid')
  url.searchParams.delete('materialJourney')
  url.searchParams.delete('ownerJourney')
  url.hash = 'project-receipt-link'
  return validateProjectJourneyReturnTo(`${url.pathname}${url.search}${url.hash}`, props.originHint) ?? journeyReturnTo.value
})
const receiptListTo = computed(() => `/finance/receipt?${new URLSearchParams({ origin: props.originHint, projectId: props.projectId, returnTo: receiptReturnTo.value })}`)
const receiptIncomeReason = computed(() => {
  const source = item.value?.income.missingSources.join(' ') ?? ''
  return source.includes('forbidden') ? '当前无权读取收款事实' : source.includes('unavailable') ? '收款来源暂时不可用，请重新读取' : '收款金额尚未完整记录'
})
function captureReceiptOrigin() {
  saveReceiptSourceOrigin({ returnTo: receiptReturnTo.value, scrollTop: workspaceScrollTop(), scrollLeft: 0 })
}
const ownerJourneyCards = computed(() => {
  const current = ownerJourneys.value
  if (!current)
    return []
  return ([
    { kind: 'change' as const, label: '甲方变洽签', page: current.change },
    { kind: 'report' as const, label: '月度报量', page: current.report },
    { kind: 'acceptance' as const, label: '竣工验收', page: current.acceptance },
    { kind: 'warranty' as const, label: '保修管理', page: current.warranty },
    { kind: 'final-settlement' as const, label: '最终结算', page: current.finalSettlement },
    { kind: 'penalty' as const, label: '甲方罚扣', page: current.penalty },
    { kind: 'project-penalty' as const, label: '项目罚扣', page: current.projectPenalty },
    { kind: 'sub-settlement' as const, label: '分包结算', page: current.subSettlement },
    { kind: 'sub-change' as const, label: '分包变洽签', page: current.subChange },
  ]).filter(card => card.page) as OwnerJourneyCard[]
})

function ownerJourneyAmount(card: OwnerJourneyCard): { label: string, value: string } {
  if (card.kind !== 'sub-change')
    return { label: '合计', value: card.page.summary.origins.real.reportedAmount === null ? `未知${card.page.summary.origins.real.amountCompleteness?.reportedAmount ? `，已知小计 ${yuan(Number(card.page.summary.origins.real.amountCompleteness.reportedAmount.knownValue))}，缺 ${card.page.summary.origins.real.amountCompleteness.reportedAmount.missingCount} 项` : ''}` : yuan(Number(card.page.summary.origins.real.reportedAmount)) }
  const summary = card.page.summary.origins.real.subcontractActualApproved
  if (summary.value == null)
    return { label: '实际审定价', value: '尚未回填' }
  return {
    label: '实际审定价',
    value: `${yuan(Number(summary.value))}${summary.status === 'partial' ? '（部分记录）' : ''}`,
  }
}

const ownerJourneyContextIds: Record<OwnerJourneyKind, string> = {
  'change': newOwnerDocumentReturnContextId(),
  'report': newOwnerDocumentReturnContextId(),
  'acceptance': newOwnerDocumentReturnContextId(),
  'warranty': newOwnerDocumentReturnContextId(),
  'final-settlement': newOwnerDocumentReturnContextId(),
  'penalty': newOwnerDocumentReturnContextId(),
  'sub-change': newOwnerDocumentReturnContextId(),
  'sub-settlement': newOwnerDocumentReturnContextId(),
  'project-penalty': newOwnerDocumentReturnContextId(),
}

function ownerJourneyReturnTo(kind: OwnerJourneyKind): string {
  const url = new URL(journeyReturnTo.value, 'https://ruihang.invalid')
  url.searchParams.set('ownerJourney', ownerJourneyContextIds[kind])
  url.hash = `project-owner-document-card-${kind}`
  return validateProjectJourneyReturnTo(`${url.pathname}${url.search}${url.hash}`, props.originHint)
    ?? `/project/${encodeURIComponent(props.projectId)}?origin=${props.originHint}`
}

function ownerJourneyTo(kind: OwnerJourneyKind) {
  const query = new URLSearchParams({
    projectId: props.projectId,
    origin: 'real',
    returnTo: ownerJourneyReturnTo(kind),
  })
  if (kind === 'acceptance' || kind === 'warranty')
    query.set('variant', kind)
  const path = kind === 'project-penalty'
    ? '/project/penalty'
    : kind === 'sub-settlement'
      ? '/subcontract/settlement'
      : kind === 'sub-change'
        ? '/subcontract/change'
        : `/owner/${kind === 'warranty' ? 'acceptance' : kind}`
  return `${path}?${query.toString()}`
}

function workspaceScrollTop(): number {
  return document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0
}

function captureMaterialJourneyOrigin() {
  try {
    saveMaterialContractJourneyReturnOrigin(createMaterialContractJourneyReturnOrigin({
      contextId: materialJourneyContextId.value,
      returnTo: materialJourneyReturnTo.value,
      anchorId: 'project-material-contract-link',
      scrollTop: workspaceScrollTop(),
      now: Date.now(),
    }))
  }
  catch {
    // 浏览器存储不可用时仍允许导航，返回时按安全锚点降级。
  }
}

function captureOwnerJourneyOrigin(kind: OwnerJourneyKind) {
  const anchorId = `project-owner-document-card-${kind}`
  try {
    saveOwnerDocumentReturnOrigin(createOwnerDocumentProjectReturnOrigin({
      contextId: ownerJourneyContextIds[kind],
      returnTo: ownerJourneyReturnTo(kind),
      anchorId,
      scrollTop: workspaceScrollTop(),
      now: Date.now(),
    }))
  }
  catch {
    // 浏览器存储不可用时仍允许导航，返回时按安全锚点降级。
  }
}

async function restoreProjectAnchorContext(): Promise<boolean> {
  if (!import.meta.client)
    return false
  const currentRoute = props.currentRoute || `${window.location.pathname}${window.location.search}${window.location.hash}`
  const validatedRoute = validateProjectJourneyReturnTo(currentRoute, props.originHint)
  if (!validatedRoute)
    return false
  const url = new URL(validatedRoute, 'https://ruihang.invalid')
  const anchor = decodeURIComponent(url.hash.slice(1))
  const ownerJourneyAnchor = isProjectOwnerDocumentCardAnchor(anchor)
  const materialJourneyAnchor = anchor === 'project-material-contract-link'
  const receiptJourneyAnchor = anchor === 'project-receipt-link'
  if (anchor !== 'project-detail-title' && !ownerJourneyAnchor && !materialJourneyAnchor && !receiptJourneyAnchor)
    return false
  if (ownerJourneyAnchor && !ownerJourneys.value)
    return false
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const target = document.getElementById(anchor)
  if (!target)
    return false
  const origin = materialJourneyAnchor
    ? resolveMaterialContractJourneyReturnOrigin({
        returnTo: validatedRoute,
        contextId: url.searchParams.get('materialJourney'),
        now: Date.now(),
        load: id => loadMaterialContractJourneyReturnOrigin(id),
      })
    : ownerJourneyAnchor
      ? resolveOwnerDocumentProjectReturnOrigin({
          returnTo: validatedRoute,
          contextId: url.searchParams.get('ownerJourney'),
          now: Date.now(),
          load: id => loadOwnerDocumentReturnOrigin(id),
        })
      : receiptJourneyAnchor ? loadReceiptSourceOrigin(validatedRoute) : null
  const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (origin && workspace)
    workspace.scrollTop = origin.scrollTop
  else
    target.scrollIntoView?.({ block: 'center' })
  target.focus({ preventScroll: true })
  return true
}

async function loadOwnerJourneys() {
  ownerJourneys.value = null
  ownerJourneysError.value = ''
  if (props.originHint !== 'real')
    return
  if (detail.value?.ownerJourneys) {
    const embedded = detail.value.ownerJourneys
    ownerJourneys.value = Object.keys(embedded.pages).length ? embedded.pages : null
    ownerJourneysError.value = embedded.issues.join('；')
    await restoreProjectAnchorContext()
    return
  }
  ownerJourneysError.value = '当前项目响应缺少同次读取的商务单据来源，请重新读取项目。'
}

useTabTitle(() => item.value?.project.label)

function refLabel(value: ProjectDetailReadDTO['item']['customer']): string {
  return value.state === 'resolved' ? value.label : ''
}

function projectFromRead(value: ProjectDetailReadDTO['item']): Project {
  return {
    id: value.project.id,
    name: value.project.label,
    contractName: value.contractName,
    code: value.code,
    address: value.address,
    region: value.region,
    type: '',
    area: null,
    contractAmount: value.contractAmount == null ? null : Number(value.contractAmount),
    overview: '',
    operationType: value.operationType,
    startDate: value.startDate ?? '',
    plannedEnd: value.plannedEnd ?? '',
    actualEnd: value.actualEnd ?? '',
    plannedDuration: value.plannedDuration,
    status: value.status,
    customerId: value.customer.state === 'resolved' ? value.customer.id : null,
    secondaryCustomerId: value.secondaryCustomer.state === 'resolved'
      ? value.secondaryCustomer.id
      : null,
    developer: refLabel(value.customer),
    developer2: refLabel(value.secondaryCustomer),
    developerSupervisor: '',
    supervisor: '',
    designer: '',
    contractor: value.contractor,
    manager: value.manager,
    managerPhone: '',
    execManager: value.execManager,
    builder: value.builder,
    siteLeader: '',
    siteLeaderPhone: '',
    riskLevel: value.riskLevel,
    approvalStatus: '',
    acceptanceDate: '',
    filingDate: '',
    note: '',
    description: '',
    source: 'central-read',
    createdBy: '',
    createdAt: '',
    updatedBy: '',
    updatedAt: value.updatedAt,
  }
}

async function loadProject() {
  const loadId = ++latestLoad
  state.value = 'loading'
  problem.value = null
  try {
    const result = await repository.get({
      id: props.projectId,
      origin: props.originHint,
      includeDemo: props.includeDemo,
    })
    if (loadId !== latestLoad)
      return
    if (result.item.dataOrigin !== props.originHint) {
      detail.value = null
      problem.value = projectProblem(
        'relationship-mismatch',
        '项目存在，但 URL 来源与中央身份不一致',
      )
      state.value = 'mismatch'
      return
    }
    detail.value = result
    state.value = 'ready'
    void loadOwnerJourneys()
    await nextTick()
    const restored = await restoreProjectAnchorContext()
    if (loadId === latestLoad && !restored)
      titleRef.value?.focus()
  }
  catch (cause) {
    if (loadId !== latestLoad)
      return
    detail.value = null
    problem.value = projectProblemFromUnknown(cause).problem
    if (problem.value.code === 'forbidden')
      state.value = 'forbidden'
    else if (problem.value.code === 'relationship-mismatch')
      state.value = 'mismatch'
    else if (problem.value.code === 'not-found')
      state.value = 'not-found'
    else
      state.value = 'error'
  }
}

watch(
  () => [props.projectId, props.originHint, props.includeDemo] as const,
  () => void loadProject(),
  { immediate: true },
)

watch(
  () => props.currentRoute,
  () => void restoreProjectAnchorContext(),
  { flush: 'post' },
)

watch(
  () => commandStore.latestWrite,
  (write) => {
    if (write?.id === props.projectId)
      void loadProject()
  },
)

watch(
  () => projectSupplierCommandStore.latestWrite,
  (write) => {
    if (write?.projectId === props.projectId)
      void loadProject()
  },
)

onActivated(() => {
  if (hasActivated)
    void loadProject()
  hasActivated = true
})
</script>

<template>
  <div
    v-if="state === 'ready' && detail && item && project"
    data-ui="project-detail-screen"
    class="project-detail flex min-w-0 flex-col gap-3"
  >
    <header class="panel min-w-0 overflow-hidden" aria-labelledby="project-detail-title">
      <div class="flex min-w-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
        <span class="i-lucide-file-text h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <div class="min-w-48 flex-[1_1_22rem]">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              id="project-detail-title"
              ref="titleRef"
              tabindex="-1"
              class="m-0 min-w-0 break-words text-17px leading-6 font-800 text-ink outline-none"
            >
              {{ item.project.label }}
            </h2>
            <span class="chip bg-surface-3 text-ink-soft">项目信息</span>
            <KitStatusTag :tone="projectStatusTone(item.status)">
              {{ item.status }}
            </KitStatusTag>
            <span v-if="isDemo" class="chip chip-warn">测试数据</span>
          </div>
          <p class="m-0 mt-0.5 break-words text-11px leading-4 text-ink-soft">
            {{ item.code || '未登记项目编号' }} · {{ item.contractName || item.region || '未登记合同名称' }}
          </p>
        </div>
        <ProjectReturnLink :to="effectiveReturnTo" :expires-at="effectiveReturnExpiresAt" :label="effectiveReturnLabel" class="ml-auto" />
        <NuxtLink
          v-if="!isDemo && detail?.capabilities.includes('project:write') && (!hasLifecycle || deleted === false)"
          :to="`/project/form/${encodeURIComponent(projectId)}?origin=real`"
          class="btn-primary"
          aria-label="编辑项目"
        >
          <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑
        </NuxtLink>
      </div>

      <dl class="project-detail__metadata m-0 grid border-t border-line">
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            业务流程阶段
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ item.status || '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            经营类型
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ item.operationType || '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            项目经理
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ item.manager || '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            客户(甲方)
          </dt>
          <dd class="m-0 mt-0.5 break-words text-12px text-ink">
            {{ item.customer.state === 'resolved' ? item.customer.label : '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            承包单位
          </dt>
          <dd class="m-0 mt-0.5 break-words text-12px text-ink">
            {{ item.contractor || '未登记' }}
          </dd>
        </div>
      </dl>
    </header>

    <ProjectMaterialContractJourney
      :count="detail.materialContracts.count"
      :navigation="detail.materialContracts.navigation"
      :return-to="materialJourneyReturnTo"
      @navigate="captureMaterialJourneyOrigin"
      @retry="loadProject"
    />

    <AuxiliaryContractJourney v-if="item.dataOrigin === 'real'" :project-id="projectId" />

    <PayrollHostSection v-if="detail.payrollActual" :section="detail.payrollActual" :return-to="journeyReturnTo" @retry="loadProject" />

    <ProjectConstructionManagementFees :configuration="detail.constructionManagementFees" :return-to="journeyReturnTo" />
    <ProjectManagementFees :fees="detail.managementFees" :return-to="journeyReturnTo" @retry="loadProject" />
    <ConstructionSpendingPanel v-if="item.dataOrigin === 'real' && detail.capabilities.includes('construction-scope:read')" class="panel min-w-0 overflow-hidden p-4" :project-id="projectId" />

    <ProjectStorageActions v-if="hasLifecycle" :project-id="projectId" @state="deleted = $event" />
    <section class="panel flex min-w-0 flex-wrap items-center justify-between gap-3 p-4" aria-label="项目收款">
      <div class="min-w-0">
        <SectionHeader title="项目收款" /><p class="mb-0 mt-2 text-12px text-ink-soft">
          {{ item.income.value === null ? receiptIncomeReason : `有效收款 ${yuan(item.income.value)}` }}
        </p>
      </div>
      <NuxtLink v-if="detail.capabilities.includes('receipt:read')" id="project-receipt-link" :to="receiptListTo" class="btn-secondary h-8 px-4 text-12px" @click="captureReceiptOrigin">
        查看收款登记
      </NuxtLink>
      <span v-else class="text-12px text-ink-faint">无收款查看权限</span>
    </section>

    <section class="panel min-w-0 overflow-hidden p-3" aria-labelledby="project-owner-document-title">
      <SectionHeader id="project-owner-document-title" title="项目商务单据" subtitle="合同、变洽签、报量、验收保修、结算和罚扣按原稳定 ID 互相查阅，返回时保留项目上下文" />
      <div v-if="ownerJourneys" class="mt-3">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NuxtLink
            v-for="card in ownerJourneyCards"
            :id="`project-owner-document-card-${card.kind}`"
            :key="card.kind"
            :to="ownerJourneyTo(card.kind)"
            class="block scroll-mt-4 border border-line bg-surface-1 p-3 transition-colors hover:border-brand/40 hover:bg-brand-soft/35"
            @click="captureOwnerJourneyOrigin(card.kind)"
          >
            <span class="text-13px font-700 text-ink">{{ card.label }}</span>
            <span class="mt-1 block font-mono text-20px font-800 text-brand-deep">{{ card.page.pagination.total }}</span>
            <span class="mt-1 block text-11px text-ink-soft">{{ ownerJourneyAmount(card).label }} {{ ownerJourneyAmount(card).value }}</span>
          </NuxtLink>
        </div>
        <StatePanel v-if="ownerJourneysError" class="mt-3" kind="error" title="部分项目商务单据暂不可用" :description="ownerJourneysError" action-label="重新读取" compact @action="loadProject" />
      </div>
      <StatePanel v-else-if="ownerJourneysError" class="mt-3" kind="error" title="项目商务单据读取失败" :description="ownerJourneysError" action-label="重新读取" compact @action="loadProject" />
      <StatePanel v-else-if="originHint !== 'real'" class="mt-3" kind="empty" title="演示项目不提供正式项目商务单据" description="切换到正式项目后可查看收入侧单据与分包变洽签主链。" compact />
      <StatePanel v-else class="mt-3" kind="loading" title="正在读取项目商务单据" compact />
    </section>

    <section
      data-authoritative-readonly
      :data-demo-readonly="isDemo || undefined"
      class="panel min-w-0 overflow-hidden"
      role="status"
      :aria-label="isDemo ? '测试数据只读详情' : '中央项目只读详情'"
    >
      <div
        v-if="isDemo"
        class="border-b border-warn/30 bg-warn/8 px-3 py-2 text-12px leading-5 text-ink-soft"
      >
        <b class="text-warn">测试数据仅供查看。</b>
        正式新增、编辑、审批、付款、归档和删除入口不会作用于这条记录；修改测试数据需进入独立演示工作区。
      </div>
      <div class="grid min-w-0 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div class="min-w-0 overflow-x-auto">
          <ProjectDetailTab :project="project" />
        </div>
        <ProjectSupplierLinksPanel
          :project-id="projectId"
          :origin="item.dataOrigin"
          :access="detail.projectSuppliers.access"
          :relationships="detail.projectSuppliers.items"
          :can-import="!isDemo && detail.capabilities.includes('project-supplier:write')"
        />
      </div>
    </section>
  </div>

  <StatePanel
    v-else-if="state === 'loading'"
    kind="loading"
    title="正在从中央后台加载项目详情"
  >
    <template #action>
      <ProjectReturnLink :to="effectiveReturnTo" :expires-at="effectiveReturnExpiresAt" :label="effectiveReturnLabel" />
    </template>
  </StatePanel>
  <StatePanel
    v-else-if="state === 'forbidden'"
    kind="forbidden"
    title="无项目查看权限"
    :description="problem?.message"
  >
    <template #action>
      <ProjectReturnLink :to="effectiveReturnTo" :expires-at="effectiveReturnExpiresAt" :label="effectiveReturnLabel" />
    </template>
  </StatePanel>
  <StatePanel
    v-else-if="state === 'error'"
    kind="error"
    title="项目详情加载失败"
    :description="problem?.message"
    action-label="重新加载"
    @action="loadProject"
  >
    <template #action>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <button type="button" class="btn-primary" @click="loadProject">
          重新加载
        </button>
        <ProjectReturnLink :to="effectiveReturnTo" :expires-at="effectiveReturnExpiresAt" :label="effectiveReturnLabel" />
      </div>
    </template>
  </StatePanel>
  <StatePanel
    v-else-if="state === 'mismatch'"
    kind="empty"
    title="项目身份与来源不匹配"
    :description="problem?.message"
  >
    <template #action>
      <ProjectReturnLink :to="effectiveReturnTo" :expires-at="effectiveReturnExpiresAt" :label="effectiveReturnLabel" />
    </template>
  </StatePanel>
  <StatePanel
    v-else
    kind="empty"
    title="项目不存在或当前来源不可见"
    description="请确认测试数据开关与来源后返回项目列表重试。"
  >
    <template #action>
      <ProjectReturnLink :to="effectiveReturnTo" :expires-at="effectiveReturnExpiresAt" :label="effectiveReturnLabel" />
    </template>
  </StatePanel>
</template>

<style scoped>
.project-detail {
  container: project-detail / inline-size;
}

.project-detail__metadata {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
}

.project-detail__metadata-cell {
  min-width: 0;
  background: transparent;
}

.project-detail__metadata-cell + .project-detail__metadata-cell {
  border-left: 1px solid var(--line);
}
</style>
