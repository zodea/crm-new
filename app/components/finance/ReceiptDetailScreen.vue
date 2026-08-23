<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed, nextTick, watch } from 'vue'
import { loadCustomerReturnOrigin, resolveCustomerReturnContext } from '~/lib/customer/return-context'
import { yuan } from '~/lib/util/money'
import { useCustomerReadStore } from '~/stores/customer-read'

const props = defineProps<{
  receiptId: string
  customerId: string
  origin: DataOriginDTO
  includeDemo: boolean
  returnTo?: string
  returnContext?: string
}>()
const store = useCustomerReadStore()
const detail = computed(() => {
  const state = store.receiptState
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
})
const problem = computed(() => 'problem' in store.receiptState ? store.receiptState.problem : null)
const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
  const state = store.receiptState
  if (detail.value)
    return 'ready'
  if (state.kind === 'idle' || state.kind === 'loading')
    return 'loading'
  if (state.kind === 'forbidden')
    return 'forbidden'
  if (state.kind === 'not-found')
    return 'not-found'
  return 'error'
})
const validatedReturn = computed(() => resolveCustomerReturnContext({
  returnTo: props.returnTo,
  contextId: props.returnContext,
  now: Date.now(),
  load: loadCustomerReturnOrigin,
}))
const backTo = computed(() => {
  if (!detail.value)
    return '/finance/receipt'
  const query = new URLSearchParams({ origin: detail.value.dataOrigin, tab: 'receipts' })
  if (validatedReturn.value.origin && props.returnContext) {
    query.set('returnTo', validatedReturn.value.to)
    query.set('returnContext', props.returnContext)
  }
  return `/base/customer/${encodeURIComponent(detail.value.customer.id)}?${query.toString()}`
})

async function load() {
  await store.loadReceipt({
    id: props.receiptId,
    customerId: props.customerId,
    origin: props.origin,
    includeDemo: props.includeDemo,
  })
  if (store.receiptState.kind === 'ready') {
    await nextTick()
    document.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
  }
}

watch(() => [props.receiptId, props.customerId, props.origin, props.includeDemo], () => void load(), { immediate: true })
</script>

<template>
  <EntityDetailShell
    :title="detail?.receipt.receipt.label ?? '收款详情'"
    subtitle="收款事实 · 只读"
    :back-to="backTo"
    back-label="返回客户收款明细"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '收款记录不存在或已删除' : shellState === 'forbidden' ? '无权查看该收款记录' : shellState === 'loading' ? '正在加载收款详情' : '收款详情加载失败'"
    :state-description="problem?.message ?? ''"
    :state-action-label="problem?.retryable ? '重新加载' : ''"
    @state-action="load"
  >
    <template #status>
      <span v-if="detail" class="chip">{{ detail.dataOrigin === 'demo' ? '测试数据' : '正式数据' }}</span>
      <span v-if="detail" :class="detail.receipt.isDraft ? 'chip chip-warn' : 'chip chip-ok'">
        {{ detail.receipt.status || '未登记' }}
      </span>
    </template>
    <template #summary>
      <MetricGrid v-if="detail" :cols="3">
        <Metric label="登记金额" :value="yuan(detail.receipt.amount)" />
        <Metric label="有效收款" :value="yuan(detail.receipt.effectiveAmount)" />
        <Metric label="收款日期" :value="detail.receipt.receiptDate || '—'" />
      </MetricGrid>
    </template>

    <StatePanel
      v-if="store.receiptState.kind === 'error' && detail"
      kind="error"
      title="刷新收款详情失败"
      :description="store.receiptState.problem.message"
      :action-label="store.receiptState.problem.retryable ? '重新加载' : ''"
      compact
      @action="load"
    />
    <section v-if="detail" class="panel grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="收款详情字段">
      <div class="grid gap-1">
        <span class="text-11px text-ink-faint">付款方客户</span>
        <CustomerRelationLink :reference="detail.customer" :navigation="detail.customerNavigation" />
      </div>
      <div class="grid gap-1">
        <span class="text-11px text-ink-faint">项目</span>
        <CustomerRelationLink :reference="detail.receipt.project" :navigation="detail.receipt.projectNavigation" />
      </div>
      <div class="grid gap-1">
        <span class="text-11px text-ink-faint">施工合同</span>
        <CustomerRelationLink :reference="detail.receipt.contract" :navigation="detail.receipt.contractNavigation" />
      </div>
      <div
        v-for="field in [
          ['付款账户', detail.receipt.payerAccount || '—'],
          ['收款方式', detail.receipt.paymentMethod || '—'],
          ['数据时点', detail.asOf],
        ]" :key="field[0]" class="grid gap-1"
      >
        <span class="text-11px text-ink-faint">{{ field[0] }}</span>
        <span class="break-words text-13px text-ink">{{ field[1] }}</span>
      </div>
    </section>
  </EntityDetailShell>
</template>
