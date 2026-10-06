<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import OwnerAcceptanceFilesPanel from '~/components/owner-document/OwnerAcceptanceFilesPanel.vue'
import OwnerPenaltyFactsPanel from '~/components/owner-document/OwnerPenaltyFactsPanel.vue'
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
  if ((current.kind === 'loading' || (current.kind === 'error' || current.kind === 'unavailable')) && current.previous)
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
    return '正在读取甲方罚扣'
  if (shellState.value === 'forbidden')
    return '无权查看甲方罚扣'
  if (shellState.value === 'not-found')
    return '甲方罚扣不存在'
  return '甲方罚扣读取失败'
})
const returnContext = computed(() => resolveOwnerDocumentReturnContext({
  kind: 'owner_penalty',
  returnTo: route.query.returnTo,
  contextId: route.query.returnContext,
  origin: props.origin,
  now: Date.now(),
  load: id => import.meta.client ? loadOwnerDocumentReturnOrigin(id) : null,
}))
const backLabel = computed(() => returnContext.value.to.split('?')[0] === '/owner/penalty'
  ? '返回甲方罚扣列表'
  : '返回来源详情')
const canEdit = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('owner-document:write')
  && ownerDocumentStatusIsEditable(detail.value.document.status))
const penaltyAmount = computed(() => detail.value?.document.amounts.kind === 'owner_penalty'
  ? detail.value.document.amounts.amount
  : null)

function amount(value: string | null): string {
  return value == null ? '未记录' : `-${yuan(Number(value))}`
}

function load() {
  return store.loadDetail({
    kind: 'owner_penalty',
    id: props.documentId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
    variant: null,
  })
}

function edit() {
  void navigateTo({
    path: ownerDocumentFormPath('owner_penalty', props.documentId),
    query: { origin: 'real', returnTo: route.fullPath },
  })
}

watch(() => [props.documentId, props.origin], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.document.name ?? '甲方罚扣详情')
</script>

<template>
  <div class="owner-penalty-detail min-w-0" data-testid="owner-penalty-detail">
    <EntityDetailShell
      :title="detail?.document.name ?? '甲方罚扣详情'"
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
        <template v-if="detail">
          <span class="chip" :class="detail.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">
            {{ detail.dataOrigin === 'demo' ? '演示只读' : '正式数据' }}
          </span>
          <span class="chip bg-surface-3 text-ink-soft">{{ detail.document.approval.label }}</span>
        </template>
      </template>
      <template #actions>
        <KitButton v-if="canEdit" variant="secondary" data-testid="owner-penalty-edit" @click="edit">
          编辑罚扣
        </KitButton>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="3">
          <Metric label="罚扣金额" :value="amount(penaltyAmount)" />
          <Metric label="罚扣日期" :value="detail.ownerPenaltyFacts?.penaltyDate || '未记录'" />
          <Metric label="当前状态" :value="detail.document.approval.label" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel
          v-if="(store.detailState.kind === 'error' || store.detailState.kind === 'unavailable')"
          kind="error"
          title="刷新甲方罚扣失败"
          :description="`${store.detailState.problem.message}；当前保留上一次成功读取的详情。`"
          :action-label="store.detailState.problem.retryable ? '重新加载' : ''"
          compact
          @action="load"
        />
        <StatePanel v-if="loading" kind="loading" title="正在刷新甲方罚扣" description="当前保留上一次成功读取的详情。" compact />
        <OwnerPenaltyFactsPanel :detail="detail" :return-to="route.fullPath" />
        <OwnerAcceptanceFilesPanel label="甲方罚扣" :files="detail.files" />
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.owner-penalty-detail { container-type: inline-size; }
</style>
