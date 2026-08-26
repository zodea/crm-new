<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import OwnerAcceptanceFilesPanel from '~/components/owner-document/OwnerAcceptanceFilesPanel.vue'
import OwnerFinalSettlementFactsPanel from '~/components/owner-document/OwnerFinalSettlementFactsPanel.vue'
import OwnerFinalSettlementSourceTable from '~/components/owner-document/OwnerFinalSettlementSourceTable.vue'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import { ownerDocumentFormPath } from '~/lib/owner-document/page'
import { loadOwnerDocumentReturnOrigin, resolveOwnerDocumentReturnContext } from '~/lib/owner-document/return-context'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useOwnerCommercialDocumentReadStore } from '~/stores/owner-commercial-document-read'

const props = defineProps<{
  documentId: string
  origin: DataOriginDTO
}>()

const route = useRoute()
const store = useOwnerCommercialDocumentReadStore()
const visibilityStore = useDataVisibilityStore()
const detail = computed(() => {
  const current = store.detailState
  if (current.kind === 'ready')
    return current.data
  if ((current.kind === 'loading' || current.kind === 'error') && current.previous)
    return current.previous
  return null
})
const loading = computed(() => store.detailState.kind === 'loading')
const problem = computed(() => 'problem' in store.detailState ? store.detailState.problem : null)
const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
  if (detail.value)
    return 'ready'
  if (store.detailState.kind === 'idle' || store.detailState.kind === 'loading')
    return 'loading'
  if (store.detailState.kind === 'forbidden')
    return 'forbidden'
  if (store.detailState.kind === 'not-found')
    return 'not-found'
  return 'error'
})
const stateTitle = computed(() => {
  if (store.detailState.kind === 'mismatch')
    return '单据来源或类型不匹配'
  if (shellState.value === 'loading')
    return '正在读取最终结算'
  if (shellState.value === 'forbidden')
    return '无权查看最终结算'
  if (shellState.value === 'not-found')
    return '最终结算不存在'
  return '最终结算读取失败'
})
const returnContext = computed(() => resolveOwnerDocumentReturnContext({
  kind: 'final_settlement',
  returnTo: route.query.returnTo,
  contextId: route.query.returnContext,
  origin: props.origin,
  now: Date.now(),
  load: id => import.meta.client ? loadOwnerDocumentReturnOrigin(id) : null,
}))
const backLabel = computed(() => returnContext.value.to.split('?')[0] === '/owner/final-settlement'
  ? '返回最终结算列表'
  : '返回来源详情')
const canEdit = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('owner-document:write')
  && ownerDocumentStatusIsEditable(detail.value.document.status))
const amounts = computed(() => detail.value?.document.amounts.kind === 'final_settlement'
  ? detail.value.document.amounts
  : null)

function amount(value: string | null | undefined): string {
  return value == null ? '未记录' : yuan(Number(value))
}

function load() {
  return store.loadDetail({
    kind: 'final_settlement',
    id: props.documentId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
    variant: null,
  })
}

function edit() {
  void navigateTo({
    path: ownerDocumentFormPath('final_settlement', props.documentId),
    query: { origin: 'real', returnTo: route.fullPath },
  })
}

watch(() => [props.documentId, props.origin], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.document.name ?? '最终结算详情')
</script>

<template>
  <div class="owner-final-settlement-detail min-w-0" data-testid="owner-final-settlement-detail">
    <EntityDetailShell
      :title="detail?.document.name ?? '最终结算详情'"
      :subtitle="detail?.document.no || '编号未填写'"
      :back-to="returnContext.to"
      :back-label="backLabel"
      :state="shellState"
      :state-title="stateTitle"
      :state-description="problem?.message ?? ''"
      :state-action-label="problem?.retryable ? '重新加载' : ''"
      @state-action="load"
    >
      <template #status>
        <span v-if="detail" class="chip bg-surface-3 text-ink-soft">{{ detail.document.approval.label }}</span>
      </template>
      <template #actions>
        <KitButton v-if="canEdit" variant="secondary" data-testid="final-settlement-edit" @click="edit">
          编辑结算
        </KitButton>
      </template>
      <template #summary>
        <MetricGrid v-if="detail && amounts" :cols="5">
          <Metric label="报审金额" :value="amount(amounts.declared)" />
          <Metric label="审定金额" :value="amount(amounts.audited)" />
          <Metric label="变更后合同额" :value="amount(amounts.changedContract)" />
          <Metric label="累计收款" :value="amount(amounts.cumulativeReceipts)" />
          <Metric label="结算收款差额" :value="amount(amounts.receiptDifference)" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel v-if="loading" kind="loading" title="正在刷新最终结算" description="当前保留上一次成功读取的详情。" compact />
        <OwnerFinalSettlementFactsPanel :detail="detail" :return-to="route.fullPath" />
        <OwnerFinalSettlementSourceTable
          :sources="detail.finalSettlementEvidence?.sources ?? null"
          :return-to="route.fullPath"
          @retry="load"
        />
        <OwnerAcceptanceFilesPanel label="最终结算" :files="detail.files" />
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.owner-final-settlement-detail { container-type: inline-size; }
</style>
