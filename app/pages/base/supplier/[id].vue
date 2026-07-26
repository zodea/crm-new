<script setup lang="ts">
import type { StatusTone } from '~/lib/supplier/status'
import type { SupplierDetailSnapshot } from '~/stores/supplier-detail'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE } from '~/lib/supplier/status'
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

watch(supplierId, async (id) => {
  await store.load()
  await detailStore.load(id)
}, { immediate: true })
</script>

<template>
  <div v-if="supplier" class="flex min-w-0 flex-col gap-4">
    <header class="panel px-4 py-3">
      <div class="flex flex-wrap items-center gap-3">
        <NuxtLink to="/base/supplier" class="btn-secondary px-2.5" aria-label="返回分供方列表">
          <span class="i-lucide-arrow-left mr-1" aria-hidden="true" />返回列表
        </NuxtLink>
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-18px font-800 text-brand">
          {{ supplier.name.slice(0, 1) }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-18px font-800 text-ink">
              {{ supplier.name }}
            </h2>
            <span class="chip" :class="credentialChipClass(supplier.credentialStatus)">
              {{ CREDENTIAL_STATUS_LABEL[supplier.credentialStatus] || supplier.credentialStatus }}
            </span>
          </div>
          <p class="mt-1 truncate text-11px text-ink-soft">
            {{ supplier.supplierCategory || '未分类' }} · 评价 {{ supplier.rating || '—' }} ·
            联系人 {{ supplier.contact || '—' }} · {{ supplier.contactPhone || '—' }}
          </p>
        </div>
        <button type="button" class="btn-secondary" @click="warning(`工商查询接口接入后可查询「${supplier.name}」`)">
          <span class="i-lucide-search-check mr-1" aria-hidden="true" />爱企查
        </button>
        <button type="button" class="btn-primary" @click="navigateTo(`/base/supplier/form/${supplier.id}`)">
          <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑
        </button>
      </div>
    </header>

    <div class="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <main class="min-w-0">
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
      </main>

      <aside class="flex min-w-0 flex-col gap-4">
        <section class="panel p-4" aria-label="跨项目汇总">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-13px font-700 text-ink">
              跨项目汇总
            </h3>
            <span class="chip chip-ok">实时</span>
          </div>
          <dl data-testid="supplier-summary">
            <div
              v-for="(row, index) in summaryRows"
              :key="row.label"
              class="flex items-center justify-between gap-3 py-2"
              :class="index ? 'border-t border-line' : ''"
            >
              <dt class="text-11px text-ink-soft">
                {{ row.label }}
              </dt>
              <dd class="font-mono text-13px font-700" :class="row.danger ? 'text-danger' : 'text-ink'">
                {{ row.value }}
              </dd>
            </div>
          </dl>
        </section>

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
      </aside>
    </div>
  </div>

  <div v-else class="panel py-12 text-center text-12px text-ink-faint">
    {{ store.loading ? '正在加载分供方…' : '分供方不存在或已删除' }}
  </div>
</template>
