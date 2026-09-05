<script setup lang="ts">
import type { DataOriginDTO, NavigationIntentDTO } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import { ownerDocumentFormPath } from '~/lib/owner-document/page'
import { loadOwnerDocumentReturnOrigin, resolveOwnerDocumentReturnContext } from '~/lib/owner-document/return-context'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useOwnerCommercialDocumentReadStore } from '~/stores/owner-commercial-document-read'

const props = defineProps<{ documentId: string, origin: DataOriginDTO }>()
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
const stateTitle = computed(() => store.detailState.kind === 'mismatch'
  ? '单据来源或关系不匹配'
  : shellState.value === 'loading'
    ? '正在读取分包变洽签'
    : shellState.value === 'forbidden'
      ? '无权查看分包变洽签'
      : shellState.value === 'not-found'
        ? '分包变洽签不存在'
        : '分包变洽签读取失败')
const returnContext = computed(() => resolveOwnerDocumentReturnContext({
  kind: 'sub_change',
  returnTo: route.query.returnTo,
  contextId: route.query.returnContext,
  origin: props.origin,
  now: Date.now(),
  load: id => import.meta.client ? loadOwnerDocumentReturnOrigin(id) : null,
}))
const backLabel = computed(() => returnContext.value.to.split('?')[0] === '/subcontract/change'
  ? '返回分包变洽签列表'
  : '返回来源详情')
const canEdit = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('subcontract-document:write')
  && ownerDocumentStatusIsEditable(detail.value.document.status))
const amounts = computed(() => detail.value?.document.amounts.kind === 'sub_change'
  ? detail.value.document.amounts
  : null)

function relationLabel(intent: NavigationIntentDTO, fallback: string): string {
  return 'subject' in intent && intent.subject.state === 'resolved' ? intent.subject.label : fallback
}

function money(value: string | null | undefined): string {
  return value == null ? '未记录' : yuan(Number(value))
}

function fileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function load() {
  return store.loadDetail({
    kind: 'sub_change',
    id: props.documentId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
    variant: null,
  })
}

function edit() {
  void navigateTo({
    path: ownerDocumentFormPath('sub_change', props.documentId),
    query: { origin: 'real', returnTo: route.fullPath },
  })
}

watch(() => [props.documentId, props.origin], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.document.name ?? '分包变洽签详情')
</script>

<template>
  <div class="subcontract-change-detail min-w-0" data-testid="subcontract-change-detail">
    <EntityDetailShell
      :title="detail?.document.name ?? '分包变洽签详情'"
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
        <button v-if="canEdit" type="button" class="btn-secondary" data-testid="subcontract-change-edit" @click="edit">
          编辑变洽签
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="4">
          <Metric label="审批金额" :value="money(amounts?.approved)" />
          <Metric label="变更面积" :value="amounts?.changedArea == null ? '未记录' : `${amounts.changedArea} ㎡`" />
          <Metric label="实际审定价" :value="money(amounts?.actualApproved)" />
          <Metric label="当前状态" :value="detail.document.approval.label" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel
          v-if="store.detailState.kind === 'error'"
          kind="error"
          title="刷新分包变洽签失败"
          :description="`${store.detailState.problem.message}；当前保留上一次成功读取的详情。`"
          :action-label="store.detailState.problem.retryable ? '重新加载' : ''"
          compact
          @action="load"
        />
        <StatePanel v-if="loading" kind="loading" title="正在刷新分包变洽签" description="当前保留上一次成功读取的详情。" compact />

        <section class="panel p-4" aria-labelledby="subcontract-change-basic-title">
          <SectionHeader id="subcontract-change-basic-title" title="变更信息" subtitle="只读展示中央正式事实与稳定关系" />
          <div class="detail-grid mt-3">
            <div class="detail-row">
              <span>所属项目</span>
              <EntityLink type="project" :intent="detail.projectNavigation" :label="relationLabel(detail.projectNavigation, '项目不可用')" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>分供方</span>
              <EntityLink type="supplier" :intent="detail.supplierNavigation" :label="relationLabel(detail.supplierNavigation, '分供方不可用')" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>分包合同</span>
              <EntityLink type="contract" :intent="detail.contractNavigation" :label="relationLabel(detail.contractNavigation, '合同不可用')" :return-to="route.fullPath" />
            </div>
            <div class="detail-row">
              <span>变更类型</span><strong>{{ detail.document.documentType || '未记录' }}</strong>
            </div>
            <div class="detail-row">
              <span>变更日期</span><strong class="font-mono">{{ detail.document.applicationDate || '未记录' }}</strong>
            </div>
            <div class="detail-row">
              <span>审批摘要</span><strong>{{ detail.document.approval.summary }}</strong>
            </div>
            <div class="detail-row">
              <span>来源单据</span>
              <EntityLink type="contract" :intent="detail.sourceNavigation" :label="relationLabel(detail.sourceNavigation, '来源不可用')" :return-to="route.fullPath" />
            </div>
            <div class="detail-row full">
              <span>变更事由</span><strong>{{ detail.document.name || '未记录' }}</strong>
            </div>
            <div class="detail-row full">
              <span>备注</span><strong>{{ detail.document.note || '未记录' }}</strong>
            </div>
          </div>
        </section>

        <section class="panel p-4" aria-labelledby="subcontract-change-files-title">
          <SectionHeader id="subcontract-change-files-title" title="附件" subtitle="只读展示随中央单据保存的文件引用" />
          <ul v-if="detail.files.length" class="mt-3 grid gap-2" aria-label="分包变洽签附件列表">
            <li v-for="file in detail.files" :key="file.id" class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-line px-3 py-2 text-12px">
              <span class="min-w-0 break-all font-600">{{ file.fileName }}</span>
              <span class="text-ink-soft">{{ file.category || '未分类' }} · {{ fileSize(file.fileSize) }}</span>
            </li>
          </ul>
          <StatePanel v-else class="mt-3" kind="empty" title="暂无附件" description="该分包变洽签尚未关联附件。" compact />
        </section>
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.subcontract-change-detail { container-type: inline-size; }
</style>
