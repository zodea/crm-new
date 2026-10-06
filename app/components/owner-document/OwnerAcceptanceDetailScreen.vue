<script setup lang="ts">
import type { OwnerAcceptanceViewVariant } from '~/lib/owner-document/central-repository'
import type { DataOriginDTO } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import OwnerAcceptanceAuditPanel from '~/components/owner-document/OwnerAcceptanceAuditPanel.vue'
import OwnerAcceptanceFactsPanel from '~/components/owner-document/OwnerAcceptanceFactsPanel.vue'
import OwnerAcceptanceFilesPanel from '~/components/owner-document/OwnerAcceptanceFilesPanel.vue'
import { ownerDocumentFormPath } from '~/lib/owner-document/page'
import { loadOwnerDocumentReturnOrigin, resolveOwnerDocumentReturnContext } from '~/lib/owner-document/return-context'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useOwnerCommercialDocumentReadStore } from '~/stores/owner-commercial-document-read'

const props = defineProps<{
  documentId: string
  origin: DataOriginDTO
  variant: OwnerAcceptanceViewVariant
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
const viewLabel = computed(() => props.variant === 'acceptance' ? '竣工验收' : '保修到期确认')
const returnContext = computed(() => resolveOwnerDocumentReturnContext({
  kind: 'acceptance',
  returnTo: route.query.returnTo,
  contextId: route.query.returnContext,
  origin: props.origin,
  now: Date.now(),
  load: id => import.meta.client ? loadOwnerDocumentReturnOrigin(id) : null,
}))
const canProcess = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('owner-document:write')
  && detail.value.document.status !== 'expired')

function load() {
  return store.loadDetail({
    kind: 'acceptance',
    id: props.documentId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
    variant: props.variant,
  })
}

function switchTo(variant: OwnerAcceptanceViewVariant) {
  void navigateTo({ path: route.path, query: { ...route.query, origin: props.origin, variant } })
}

function processLifecycle() {
  void navigateTo({
    path: ownerDocumentFormPath('acceptance', props.documentId),
    query: { origin: 'real', returnTo: route.fullPath },
  })
}

watch(() => [props.documentId, props.origin, props.variant], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.document.name ?? `${viewLabel.value}详情`)
</script>

<template>
  <div class="owner-acceptance-detail min-w-0" data-testid="owner-acceptance-detail">
    <EntityDetailShell
      :title="detail?.document.name ?? `${viewLabel}详情`"
      :subtitle="detail?.document.no || '编号未填写'"
      :back-to="returnContext.to"
      back-label="返回验收·保修列表"
      :state="shellState"
      :state-title="shellState === 'loading' ? `正在读取${viewLabel}` : `${viewLabel}读取失败`"
      :state-description="problem?.message ?? ''"
      :state-action-label="problem?.retryable ? '重新加载' : ''"
      @state-action="load"
    >
      <template #status>
        <template v-if="detail">
          <span class="chip chip-brand">同一验收 ID</span>
          <span class="chip bg-surface-3 text-ink-soft">{{ detail.document.approval.label }}</span>
        </template>
      </template>
      <template #actions>
        <KitButton v-if="canProcess" variant="secondary" data-testid="owner-acceptance-process" @click="processLifecycle">
          处理流转
        </KitButton>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="4">
          <Metric label="合同估算金额" :value="yuan(Number(detail.document.amounts.kind === 'acceptance' ? detail.document.amounts.contractEstimate : 0))" />
          <Metric label="当前状态" :value="detail.document.approval.label" />
          <Metric label="验收 ID" :value="detail.document.id" />
          <Metric label="更新时间" :value="detail.document.updatedAt" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel v-if="loading" kind="loading" :title="`正在刷新${viewLabel}`" description="当前保留上一次成功读取的详情。" compact />
        <nav class="panel flex flex-wrap gap-2 p-2" aria-label="验收保修视图">
          <button
            v-for="item in [{ key: 'acceptance', label: '竣工验收' }, { key: 'warranty', label: '保修到期确认' }]"
            :key="item.key"
            type="button"
            class="btn-ghost min-h-9"
            :class="{ 'bg-brand-soft text-brand-deep': variant === item.key }"
            :aria-current="variant === item.key ? 'page' : undefined"
            @click="switchTo(item.key as OwnerAcceptanceViewVariant)"
          >
            {{ item.label }}
          </button>
        </nav>

        <section class="panel p-4" aria-labelledby="acceptance-common-title">
          <SectionHeader id="acceptance-common-title" title="生命周期主记录" subtitle="两个视图共享同一稳定 ID、项目、合同与状态" />
          <div class="detail-grid mt-3">
            <div class="detail-row">
              <span>验收 ID</span><strong class="font-mono">{{ detail.document.id }}</strong>
            </div>
            <div class="detail-row">
              <span>所属项目</span><EntityLink type="project" :intent="detail.projectNavigation" label="查看项目" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>施工合同</span><EntityLink type="contract" :intent="detail.contractNavigation" label="查看合同" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>来源事实</span><EntityLink type="contract" :intent="detail.sourceNavigation" label="查看合同验收行" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>申报日期</span><strong class="font-mono">{{ detail.document.applicationDate || '未记录' }}</strong>
            </div>
            <div class="detail-row full">
              <span>备注</span><strong>{{ detail.document.note || '未记录' }}</strong>
            </div>
          </div>
        </section>

        <OwnerAcceptanceFactsPanel v-if="detail.acceptanceView" :view="detail.acceptanceView" />
        <OwnerAcceptanceFilesPanel :label="viewLabel" :files="detail.files" />
        <OwnerAcceptanceAuditPanel :events="detail.lifecycleEvents" />
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.owner-acceptance-detail { container-type: inline-size; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 0 28px; }
.detail-row { display: flex; min-width: 0; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.detail-row > span { width: 112px; flex: none; color: var(--ink-soft); }
.detail-row > strong { min-width: 0; overflow-wrap: anywhere; }
.detail-row.full { grid-column: 1 / -1; }
</style>
