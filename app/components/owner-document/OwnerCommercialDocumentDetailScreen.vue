<script setup lang="ts">
import type {
  OwnerCommercialDocumentDetailReadDTO,
  OwnerCommercialDocumentKind,
} from '~/lib/owner-document/central-repository'
import type { DataOriginDTO, NavigationIntentDTO, ReadState } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import { OWNER_DOCUMENT_META, ownerDocumentFormPath } from '~/lib/owner-document/page'
import {
  loadOwnerDocumentReturnOrigin,
  resolveOwnerDocumentReturnContext,
} from '~/lib/owner-document/return-context'
import { isQuantityBasis, quantityBasisLabel } from '~/lib/quantity/basis'
import { readProblemTitle } from '~/lib/read-model/state'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useOwnerCommercialDocumentReadStore } from '~/stores/owner-commercial-document-read'

const props = defineProps<{
  kind: OwnerCommercialDocumentKind
  documentId: string
  origin: DataOriginDTO
}>()

const route = useRoute()
const store = useOwnerCommercialDocumentReadStore()
const visibilityStore = useDataVisibilityStore()
const meta = computed(() => OWNER_DOCUMENT_META[props.kind])
const state = computed(() => store.detailState as ReadState<OwnerCommercialDocumentDetailReadDTO>)
const detail = computed(() => {
  const current = state.value
  if (current.kind === 'ready')
    return current.data
  if ((current.kind === 'loading' || (current.kind === 'error' || current.kind === 'unavailable')) && current.previous)
    return current.previous
  return null
})
const loading = computed(() => state.value.kind === 'loading')
const problem = computed(() => 'problem' in state.value ? state.value.problem : null)
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
const stateTitle = computed(() => state.value.kind === 'mismatch'
  ? '单据来源或类型不匹配'
  : shellState.value === 'loading'
    ? `正在读取${meta.value.label}`
    : shellState.value === 'forbidden'
      ? `无权查看该${meta.value.label}`
      : shellState.value === 'not-found'
        ? `未找到${meta.value.label}`
        : `${meta.value.label}读取失败`)

const returnContext = computed(() => resolveOwnerDocumentReturnContext({
  kind: props.kind,
  returnTo: route.query.returnTo,
  contextId: route.query.returnContext,
  origin: props.origin,
  now: Date.now(),
  load: id => import.meta.client ? loadOwnerDocumentReturnOrigin(id) : null,
}))
const canOpenForm = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('owner-document:write')
  && (ownerDocumentStatusIsEditable(detail.value.document.status)
    || (props.kind === 'owner_change' && detail.value.document.status === 'submitted')
    || (props.kind === 'owner_report' && detail.value.document.status === 'reported')))
const formActionLabel = computed(() => detail.value && ownerDocumentStatusIsEditable(detail.value.document.status)
  ? '编辑单据'
  : '处理流转')
const metrics = computed(() => {
  const current = detail.value?.document.amounts
  if (!current)
    return []
  if (current.kind === 'owner_change') {
    return [
      { label: '量价变更合计', value: yuan(Number(current.boqChange)) },
      { label: '含税审定金额', value: yuan(Number(current.taxInclusive)) },
      { label: '无税审定金额', value: yuan(Number(current.taxExclusive)) },
      { label: '无税申报金额', value: yuan(Number(current.appliedTaxExclusive)) },
      { label: '审批状态', value: detail.value?.document.approval.label ?? '—' },
    ]
  }
  if (current.kind === 'owner_report') {
    return [
      { label: '申报金额', value: yuan(Number(current.reported)) },
      { label: '审定金额', value: current.audited == null ? '未审定' : yuan(Number(current.audited)) },
      { label: '审定差额', value: current.difference == null ? '—' : yuan(Number(current.difference)) },
      { label: '审批状态', value: detail.value?.document.approval.label ?? '—' },
    ]
  }
  if (current.kind === 'final_settlement')
    return []
  if (current.kind === 'owner_penalty' || current.kind === 'project_penalty')
    return [{ label: '罚扣金额', value: `-${yuan(Number(current.amount))}` }]
  if (current.kind === 'sub_settlement')
    return [{ label: '含税结算额', value: money(current.total) }]
  if (current.kind === 'sub_change')
    return []
  return [
    { label: '合同估算金额', value: yuan(Number(current.contractEstimate)) },
    { label: '生命周期状态', value: detail.value?.document.approval.label ?? '—' },
  ]
})

function load() {
  return store.loadDetail({
    kind: props.kind,
    id: props.documentId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
    variant: null,
  })
}

function edit() {
  void navigateTo({
    path: ownerDocumentFormPath(props.kind, props.documentId),
    query: { origin: 'real', returnTo: route.fullPath },
  })
}

function relationLabel(intent: NavigationIntentDTO, fallback: string): string {
  return 'subject' in intent && intent.subject.state === 'resolved' ? intent.subject.label : fallback
}

function quantityBasisDisplay(value: string | null): string {
  if (!value)
    return '未记录'
  return isQuantityBasis(value) ? quantityBasisLabel(value) : `未知基准（${value}）`
}

function quantity(value: string | null): string {
  return value ?? '—'
}

function money(value: string | null): string {
  return value == null ? '—' : yuan(Number(value))
}

function fileSize(bytes: number | null): string {
  if (bytes === null)
    return '大小未知'
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

watch(() => [props.kind, props.documentId, props.origin], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.document.name ?? `${meta.value.label}详情`)
</script>

<template>
  <div class="owner-commercial-detail min-w-0" data-testid="owner-commercial-document-detail">
    <EntityDetailShell
      :title="detail?.document.name ?? `${meta.label}详情`"
      :subtitle="detail?.document.no || '编号未填写'"
      :back-to="returnContext.to"
      :back-label="`返回${meta.label}`"
      :state="shellState"
      :state-title="readProblemTitle(problem, stateTitle)"
      :state-description="problem?.message ?? ''"
      :state-action-label="problem?.retryable ? '重新加载' : ''"
      @state-action="load"
    >
      <template #status>
        <template v-if="detail">
          <span class="chip" :class="detail.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">
            {{ detail.dataOrigin === 'demo' ? '演示只读' : '正式数据' }}
          </span>
          <span class="chip bg-surface-3 text-ink-soft">{{ detail.document.approval.label }}</span>
        </template>
      </template>
      <template #actions>
        <button v-if="canOpenForm" type="button" class="btn-secondary" data-testid="owner-document-edit" @click="edit">
          {{ formActionLabel }}
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="4">
          <Metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel v-if="(state.kind === 'error' || state.kind === 'unavailable')" kind="error" :title="`刷新${meta.label}失败`" :description="`${state.problem.message}；当前保留上一次成功读取的详情。`" :action-label="state.problem.retryable ? '重新加载' : ''" compact @action="load" />
        <StatePanel v-if="loading" kind="loading" :title="`正在刷新${meta.label}`" description="当前保留上一次成功读取的详情。" compact />

        <section class="panel p-4" aria-labelledby="owner-document-basic-title">
          <SectionHeader id="owner-document-basic-title" title="详细资料" subtitle="只读展示中央正式事实与稳定关系" />
          <div class="detail-grid mt-3">
            <div class="detail-row">
              <span>所属项目</span>
              <EntityLink type="project" :intent="detail.projectNavigation" :label="relationLabel(detail.projectNavigation, '项目不可用')" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>甲方客户</span>
              <EntityLink type="customer" :intent="detail.customerNavigation" :label="relationLabel(detail.customerNavigation, '客户不可用')" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>施工合同</span>
              <EntityLink type="contract" :intent="detail.contractNavigation" :label="relationLabel(detail.contractNavigation, '合同不可用')" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>{{ kind === 'owner_report' ? '报量期次' : '申报日期' }}</span>
              <strong class="font-mono">{{ kind === 'owner_report' ? detail.document.periodNo || '未记录' : detail.document.applicationDate || '未记录' }}</strong>
            </div>
            <div v-if="kind === 'owner_change'" class="detail-row">
              <span>签证日期</span><strong class="font-mono">{{ detail.document.approvalDate || '未签证' }}</strong>
            </div>
            <template v-if="kind === 'owner_report' && detail.document.quantityEvidence">
              <div class="detail-row">
                <span>取数基准</span><strong>{{ quantityBasisDisplay(detail.document.quantityEvidence.basis) }}</strong>
              </div>
              <div class="detail-row">
                <span>数据版本</span><strong class="font-mono">{{ detail.document.quantityEvidence.sourceVersion || '未记录' }}</strong>
              </div>
              <div class="detail-row">
                <span>源数据更新时间</span><strong class="font-mono">{{ detail.document.quantityEvidence.sourceUpdatedAt || '未记录' }}</strong>
              </div>
              <div class="detail-row">
                <span>经办/提交</span><strong>{{ detail.document.quantityEvidence.operatorName || '未记录' }} · {{ detail.document.quantityEvidence.submittedAt || '未提交' }}</strong>
              </div>
            </template>
            <div class="detail-row">
              <span>审批摘要</span><strong>{{ detail.document.approval.summary }}</strong>
            </div>
            <div class="detail-row">
              <span>来源单据</span>
              <span class="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <code class="font-mono text-ink-soft">{{ detail.document.source.id || '未记录' }}</code>
                <EntityLink type="contract" :intent="detail.sourceNavigation" label="查看来源" :return-to="route.fullPath" />
              </span>
            </div>
            <div class="detail-row full">
              <span>备注</span><strong>{{ detail.document.note || '未记录' }}</strong>
            </div>
          </div>
        </section>

        <section class="panel min-w-0 overflow-hidden p-4" aria-labelledby="owner-document-lines-title">
          <SectionHeader
            id="owner-document-lines-title"
            :title="kind === 'owner_change' ? '变更量价明细' : '报量与审定明细'"
            :subtitle="kind === 'owner_change' ? '合同量价、变更量/价与审定金额' : '自动完成量、申报量、审定量与甲方核减'"
          />
          <div
            v-if="detail.lines.length"
            class="mt-3 max-w-full overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
            data-testid="owner-document-lines-scroll"
            role="region"
            :aria-label="`${kind === 'owner_change' ? '变更量价明细' : '报量与审定明细'}，可横向滚动查看完整列`"
            tabindex="0"
          >
            <table class="w-full min-w-900px border-collapse text-12px">
              <thead>
                <tr class="border-y border-line bg-surface-2 text-left text-ink-soft">
                  <th class="px-3 py-2">
                    清单项
                  </th><th class="px-3 py-2">
                    单位
                  </th><th class="px-3 py-2 text-right">
                    合同量
                  </th><th class="px-3 py-2 text-right">
                    合同单价
                  </th>
                  <template v-if="kind === 'owner_change'">
                    <th class="px-3 py-2">
                      变更方式
                    </th><th class="px-3 py-2 text-right">
                      变更量
                    </th><th class="px-3 py-2 text-right">
                      新单价
                    </th>
                  </template>
                  <template v-else>
                    <th class="px-3 py-2 text-right">
                      自动完成量
                    </th><th class="px-3 py-2 text-right">
                      申报量
                    </th><th class="px-3 py-2 text-right">
                      审定量
                    </th>
                  </template>
                  <th class="px-3 py-2 text-right">
                    申报金额
                  </th><th v-if="kind === 'owner_report'" class="px-3 py-2 text-right">
                    审定金额
                  </th><th class="px-3 py-2">
                    说明
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in detail.lines" :key="line.id" class="border-b border-line align-top">
                  <td class="px-3 py-2 font-600">
                    {{ line.itemName || '未命名清单项' }}
                  </td><td class="px-3 py-2">
                    {{ line.unit || '—' }}
                  </td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ quantity(line.contractQty) }}
                  </td><td class="px-3 py-2 text-right font-mono">
                    {{ money(line.contractUnitPrice) }}
                  </td>
                  <template v-if="kind === 'owner_change'">
                    <td class="px-3 py-2">
                      {{ line.operation || '纯金额' }}
                    </td><td class="px-3 py-2 text-right font-mono">
                      {{ quantity(line.deltaQty) }}
                    </td><td class="px-3 py-2 text-right font-mono">
                      {{ money(line.newUnitPrice) }}
                    </td>
                  </template>
                  <template v-else>
                    <td class="px-3 py-2 text-right font-mono">
                      {{ quantity(line.autoQty) }}
                    </td><td class="px-3 py-2 text-right font-mono">
                      {{ quantity(line.reportedQty) }}
                    </td><td class="px-3 py-2 text-right font-mono">
                      {{ quantity(line.auditedQty) }}
                    </td>
                  </template>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ money(line.amount) }}
                  </td><td v-if="kind === 'owner_report'" class="px-3 py-2 text-right font-mono">
                    {{ money(line.auditedAmount) }}
                  </td><td class="px-3 py-2 text-ink-soft">
                    {{ line.note || '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <StatePanel
            v-else
            class="mt-3"
            kind="empty"
            title="暂无量价明细"
            :description="kind === 'owner_change'
              ? '当前变洽签是纯金额签证，或尚未形成有效 BOQ 变更明细。'
              : '该月度报量尚未形成有效 BOQ 申报明细。'"
            compact
          />
        </section>

        <section class="panel p-4" aria-labelledby="owner-document-files-title">
          <SectionHeader id="owner-document-files-title" title="附件" subtitle="只读展示随中央单据迁移或命令保存的文件引用" />
          <ul v-if="detail.files.length" class="mt-3 grid gap-2" aria-label="单据附件列表">
            <li v-for="file in detail.files" :key="file.id" class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-surface-1 px-3 py-2.5">
              <span class="i-lucide-paperclip h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <strong class="min-w-0 flex-1 truncate text-13px" :title="file.fileName">{{ file.fileName || '未命名附件' }}</strong>
              <span class="text-11px text-ink-soft">{{ file.category || '业务附件' }}</span>
              <span class="font-mono text-11px text-ink-faint">{{ fileSize(file.fileSize) }}</span>
            </li>
          </ul>
          <StatePanel v-else class="mt-3" kind="empty" title="暂无附件" description="当前中央单据没有有效附件引用。" compact />
        </section>
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.owner-commercial-detail { container-type: inline-size; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 0 28px; }
.detail-row { display: flex; min-width: 0; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.detail-row > span { width: 96px; flex: none; color: var(--ink-soft); }
.detail-row > strong { min-width: 0; overflow-wrap: anywhere; }
.detail-row.full { grid-column: 1 / -1; }
</style>
