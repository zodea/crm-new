<script setup lang="ts">
import type { StatusTone } from '~/lib/supplier/status'
import type { SupplierDetailSnapshot } from '~/stores/supplier-detail'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE } from '~/lib/supplier/status'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

type DetailTab = 'detail' | 'credential' | 'projects' | 'contracts' | 'payments' | 'invoices'
type ReadonlyTab = Exclude<DetailTab, 'detail' | 'credential'>

const route = useRoute()
const store = useSupplierStore()
const detailStore = useSupplierDetailStore()
const { warning } = useKitUI()

const supplierId = computed(() => route.params.id as string)
const supplier = computed(() => store.byId(supplierId.value))
const snapshot = computed<SupplierDetailSnapshot>(() => detailStore.bySupplier(supplierId.value))
const hasSnapshot = computed(() => detailStore.hasSnapshot(supplierId.value))
const settledSupplierId = shallowRef('')
const loadingSupplierId = shallowRef('')
const loadError = shallowRef('')
let latestLoadRequest = 0

useTabTitle(() => supplier.value?.name)

const activeTab = shallowRef<DetailTab>('detail')
const summaryTab = computed<ReadonlyTab>(() => {
  if (activeTab.value === 'detail' || activeTab.value === 'credential')
    return 'projects'
  return activeTab.value
})
const tabs = computed(() => [
  { key: 'detail' as const, label: '详细资料' },
  { key: 'credential' as const, label: `证照附件 (${snapshot.value.credentials.length})` },
  { key: 'projects' as const, label: `合作项目 (${snapshot.value.projects.length})` },
  { key: 'contracts' as const, label: `合同汇总 (${snapshot.value.contracts.length})` },
  { key: 'payments' as const, label: `请款/付款汇总 (${snapshot.value.payments.length})` },
  { key: 'invoices' as const, label: `收票汇总 (${snapshot.value.invoices.length})` },
])

const chipToneClass: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  ok: 'chip-ok',
  danger: 'chip-danger',
}
function credentialChipClass(status: string): string {
  const tone = CREDENTIAL_STATUS_TONE[status]
  return tone ? chipToneClass[tone] : 'chip-warn'
}

const summaryRows = computed(() => [
  { label: '合作项目', value: `${snapshot.value.summary.projectCount} 个` },
  { label: '合同总额', value: yuan(snapshot.value.summary.contractTotal) },
  { label: '累计请款', value: yuan(snapshot.value.summary.claimedTotal) },
  { label: '累计收票', value: yuan(snapshot.value.summary.invoiceTotal) },
  { label: '累计已付', value: yuan(snapshot.value.summary.paidTotal) },
  { label: '应付余额', value: yuan(snapshot.value.summary.payableBalance), danger: snapshot.value.summary.payableBalance > 0 },
])

const shellState = computed(() => {
  if (supplier.value && hasSnapshot.value)
    return 'ready'
  if (loadingSupplierId.value === supplierId.value || settledSupplierId.value !== supplierId.value)
    return 'loading'
  if (loadError.value)
    return 'error'
  return 'not-found'
})
const shellStateTitle = computed(() => {
  if (shellState.value === 'loading')
    return '正在加载分供方详情'
  if (shellState.value === 'not-found')
    return '分供方不存在或已删除'
  return '分供方详情加载失败'
})
const shellStateDescription = computed(() =>
  shellState.value === 'not-found'
    ? '该分供方可能已被删除，可返回列表查看。'
    : loadError.value,
)

async function loadSupplier() {
  const id = supplierId.value
  const request = ++latestLoadRequest
  loadError.value = ''
  loadingSupplierId.value = id
  try {
    await store.load()
    if (request !== latestLoadRequest)
      return
    if (store.byId(id))
      await detailStore.load(id)
  }
  catch (cause) {
    if (request !== latestLoadRequest)
      return
    loadError.value = `分供方详情加载失败：${toErrorMessage(cause)}`
  }
  finally {
    if (request === latestLoadRequest) {
      settledSupplierId.value = id
      loadingSupplierId.value = ''
    }
  }
}

watch(supplierId, () => void loadSupplier(), { immediate: true })
</script>

<template>
  <EntityDetailShell
    :title="supplier?.name ?? '分供方详情'"
    :subtitle="supplier
      ? `${supplier.supplierCategory || '未分类'} · 评价 ${supplier.rating || '—'} · 联系人 ${supplier.contact || '—'} · ${supplier.contactPhone || '—'}`
      : ''"
    back-to="/base/supplier"
    back-label="返回分供方列表"
    aside-label="分供方文件与动态"
    :state="shellState"
    :state-title="shellStateTitle"
    :state-description="shellStateDescription"
    :state-action-label="shellState === 'error' ? '重新加载' : ''"
    @state-action="loadSupplier"
  >
    <template #mark>
      <div
        v-if="supplier"
        class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand"
      >
        {{ supplier.name.slice(0, 1) }}
      </div>
    </template>

    <template #status>
      <span v-if="supplier" class="chip" :class="credentialChipClass(supplier.credentialStatus)">
        {{ CREDENTIAL_STATUS_LABEL[supplier.credentialStatus] || supplier.credentialStatus }}
      </span>
    </template>

    <template #actions>
      <template v-if="supplier">
        <button type="button" class="btn-secondary" @click="warning(`工商查询接口接入后可查询「${supplier.name}」`)">
          <span class="i-lucide-search-check mr-1" aria-hidden="true" />爱企查
        </button>
        <button type="button" class="btn-primary" @click="navigateTo(`/base/supplier/form/${supplier.id}`)">
          <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑
        </button>
      </template>
    </template>

    <template #summary>
      <MetricGrid v-if="supplier" data-testid="supplier-summary" :cols="6">
        <Metric
          v-for="row in summaryRows"
          :key="row.label"
          :label="row.label"
          :value="row.value"
          :tone="row.danger ? 'danger' : undefined"
          :big="row.label === '应付余额'"
        />
      </MetricGrid>
    </template>

    <StatePanel
      v-if="supplier && hasSnapshot && loadingSupplierId === supplierId"
      kind="loading"
      title="正在刷新分供方详情"
      compact
      class="mb-4"
    />
    <StatePanel
      v-else-if="supplier && loadError"
      kind="error"
      title="分供方详情刷新失败"
      :description="loadError"
      action-label="重新加载"
      compact
      class="mb-4"
      @action="loadSupplier"
    />

    <template v-if="supplier">
      <nav class="mb-4 overflow-x-auto" aria-label="分供方详情分类">
        <SegTab v-model="activeTab" :tabs="tabs" />
      </nav>

      <SupplierDetailTab v-if="activeTab === 'detail'" :supplier="supplier" />
      <SupplierCredentialTab
        v-else-if="activeTab === 'credential'"
        :supplier-id="supplier.id"
        :snapshot="snapshot"
      />
      <SupplierReadonlySummaryTab v-else :supplier-id="supplier.id" :tab="summaryTab" :snapshot="snapshot" />
    </template>

    <template #aside>
      <div v-if="supplier" class="flex min-w-0 flex-col gap-4">
        <section class="panel p-4" aria-label="证照文件管理">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-13px font-700 text-ink">
              文件管理
            </h3>
            <button type="button" class="icon-btn" title="添加证照" aria-label="从文件管理添加证照" @click="activeTab = 'credential'">
              <span class="i-lucide-upload" aria-hidden="true" />
            </button>
          </div>
          <ul v-if="snapshot.credentials.length" class="divide-y divide-line">
            <li v-for="credential in snapshot.credentials" :key="credential.id" class="flex items-center gap-2 py-2">
              <span class="i-lucide-file-text shrink-0 text-14px text-ink-faint" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-11px" :title="credential.fileName">{{ credential.fileName }}</span>
              <span class="text-9px text-ink-faint">{{ credential.category }}</span>
            </li>
          </ul>
          <p v-else class="py-3 text-center text-11px text-ink-faint">
            暂无证照文件
          </p>
        </section>

        <section class="panel p-4 text-ink-faint">
          <h3 class="mb-1 text-12px font-700 text-ink-soft">
            审批 · 评论 · 动态
          </h3>
          <p class="text-11px">
            V2 接入后台后启用
          </p>
        </section>
      </div>
    </template>
  </EntityDetailShell>
</template>
