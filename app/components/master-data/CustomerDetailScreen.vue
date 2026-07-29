<script setup lang="ts">
import type { CustomerRelationTab } from './CustomerDetailRelations.vue'
import { computed, shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  customerId: string
}>()

const store = useCustomerDetailStore()
const detail = computed(() => store.byCustomer(props.customerId))
const customer = computed(() => detail.value?.customer ?? null)
const activeTab = shallowRef<CustomerRelationTab>('projects')
const settledId = shallowRef('')
const loadingId = shallowRef('')
const loadError = shallowRef('')
let latestRequest = 0

useTabTitle(() => customer.value?.name)

const statusLabel = computed(() => {
  if (!customer.value?.status)
    return '未登记'
  return customer.value.status === 'active' ? '有效' : customer.value.status === 'draft' ? '草稿' : customer.value.status
})
const shellState = computed<'ready' | 'loading' | 'error' | 'not-found'>(() => {
  if (detail.value)
    return 'ready'
  if (loadingId.value === props.customerId || settledId.value !== props.customerId)
    return 'loading'
  return loadError.value ? 'error' : 'not-found'
})

async function loadCustomer() {
  const id = props.customerId
  const request = ++latestRequest
  loadError.value = ''
  loadingId.value = id
  try {
    await store.load(id)
  }
  catch (cause) {
    if (request === latestRequest)
      loadError.value = `客户详情加载失败：${toErrorMessage(cause)}`
  }
  finally {
    if (request === latestRequest) {
      loadingId.value = ''
      settledId.value = id
    }
  }
}

watch(() => props.customerId, () => {
  activeTab.value = 'projects'
  void loadCustomer()
}, { immediate: true })
</script>

<template>
  <EntityDetailShell
    :title="customer?.name ?? '客户详情'"
    :subtitle="customer
      ? [customer.taxNo, customer.aliases.join('、')].filter(Boolean).join(' · ')
      : ''"
    back-to="/base/customer"
    back-label="返回客户列表"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '客户不存在或已删除' : shellState === 'loading' ? '正在加载客户详情' : '客户详情加载失败'"
    :state-description="shellState === 'not-found' ? '该客户可能已被删除，可返回客户列表查看。' : loadError"
    :state-action-label="shellState === 'error' ? '重新加载' : ''"
    @state-action="loadCustomer"
  >
    <template #mark>
      <div
        v-if="customer"
        class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand"
      >
        {{ customer.name.slice(0, 1) }}
      </div>
    </template>

    <template #status>
      <span v-if="customer" :class="customer.status === 'active' ? 'chip chip-ok' : 'chip chip-warn'">
        {{ statusLabel }}
      </span>
    </template>

    <template #actions>
      <NuxtLink
        v-if="customer"
        :to="`/base/customer/form/${customer.id}`"
        class="btn-primary"
        aria-label="编辑客户"
      >
        <span class="i-lucide-square-pen mr-1" aria-hidden="true" />
        编辑
      </NuxtLink>
    </template>

    <template #summary>
      <MetricGrid v-if="detail" :cols="5" data-testid="customer-summary">
        <Metric label="名下项目" :value="`${detail.summary.projectCount} 个`" />
        <Metric label="施工合同" :value="`${detail.summary.contractCount} 份`" />
        <Metric label="有效合同额" :value="yuan(detail.summary.effectiveContractAmount)" />
        <Metric label="有效收款" :value="yuan(detail.summary.effectiveReceiptAmount)" />
        <Metric label="待收差额" :value="yuan(detail.summary.outstandingAmount)" />
      </MetricGrid>
    </template>

    <div v-if="customer && detail" class="flex min-w-0 flex-col gap-4">
      <CustomerDetailOverview :customer="customer" />

      <section class="panel min-w-0 overflow-hidden" aria-labelledby="customer-relations-heading">
        <div class="flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <h3 id="customer-relations-heading" class="m-0 mr-auto text-14px font-800 text-ink">
            业务关系
          </h3>
          <div class="flex min-w-0 max-w-full overflow-x-auto" role="tablist" aria-label="客户业务关系">
            <button
              v-for="tab in ([
                { id: 'projects', label: `名下项目 ${detail.projects.length}` },
                { id: 'contracts', label: `施工合同 ${detail.contracts.length}` },
                { id: 'receipts', label: `收款明细 ${detail.receipts.length}` },
              ] as const)"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="activeTab === tab.id"
              class="shrink-0 border-b-2 px-3 py-2 text-12px font-700"
              :class="activeTab === tab.id ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
        <div class="min-w-0 p-3">
          <CustomerDetailRelations
            :tab="activeTab"
            :projects="detail.projects"
            :contracts="detail.contracts"
            :receipts="detail.receipts"
          />
        </div>
      </section>
    </div>
  </EntityDetailShell>
</template>
