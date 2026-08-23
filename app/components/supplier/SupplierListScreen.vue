<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { SupplierListPageDTO, SupplierListQueryDTO, SupplierListSort } from '~/lib/supplier/repository'
import { useDebounceFn } from '@vueuse/core'
import { computed, nextTick, onActivated, onMounted, shallowRef, watch } from 'vue'
import { createSupplierReturnTo, supplierListNavigationStateFromQuery } from '~/lib/supplier/return-context'
import { CREDENTIAL_STATUS_LABEL, SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { yuan } from '~/lib/util/money'
import { useSupplierCommandStore } from '~/stores/supplier-command'
import { useSupplierReadStore } from '~/stores/supplier-read'

const route = useRoute()
const readStore = useSupplierReadStore()
const commandStore = useSupplierCommandStore()
const visibility = useDataVisibilityStore()
const { error, typeSelect } = useKitUI()
const initial = supplierListNavigationStateFromQuery(route.query)
const search = shallowRef(initial.search)
const category = shallowRef(initial.category)
const credentialStatus = shallowRef(initial.credentialStatus)
const sort = shallowRef<SupplierListSort>(initial.sort)
const page = shallowRef(initial.page)
const pageSize = shallowRef(initial.pageSize)

const readPage = computed<SupplierListPageDTO | null>(() => {
  const state = readStore.listState
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
})
const rows = computed(() => (readPage.value?.items ?? []).map(item => ({
  id: item.supplier.id,
  identity: `${item.dataOrigin}:${item.supplier.id}`,
  name: item.supplier.label,
  dataOrigin: item.dataOrigin,
  aliases: item.aliases,
  taxNo: item.taxNo,
  supplierCategory: item.supplierCategory,
  credentialStatus: item.credentialStatus,
  contact: item.contact,
  contactPhone: item.contactPhone,
  projectCount: item.projectCount,
  contractAmount: item.contractAmount,
  paymentAmount: item.paymentAmount,
})))
const loading = computed(() => readStore.listState.kind === 'loading')
const problem = computed(() => ['forbidden', 'not-found', 'mismatch', 'error'].includes(readStore.listState.kind) && 'problem' in readStore.listState ? readStore.listState.problem : null)
const summary = computed(() => ({
  正式分供方: `${readPage.value?.summary.origins.real.supplierCount ?? 0} 家`,
  ...(visibility.includeDemo ? { 测试分供方: `${readPage.value?.summary.origins.demo.supplierCount ?? 0} 家` } : {}),
  累计合同额: yuan(Number(readPage.value?.summary.origins.real.contractAmount ?? 0) + (visibility.includeDemo ? Number(readPage.value?.summary.origins.demo.contractAmount ?? 0) : 0)),
  确认实付: yuan(Number(readPage.value?.summary.origins.real.paymentAmount ?? 0) + (visibility.includeDemo ? Number(readPage.value?.summary.origins.demo.paymentAmount ?? 0) : 0)),
}))
const categoryOptions = computed(() => [
  { key: 'all', label: '全部类别' },
  ...(readPage.value?.summary.categories ?? []).map(item => ({ key: item.value, label: `${item.label}（${item.count}）` })),
])
const credentialOptions = computed(() => [
  { key: 'all', label: '全部资料状态' },
  ...(readPage.value?.summary.credentialStatuses ?? []).map(item => ({ key: item.value, label: `${CREDENTIAL_STATUS_LABEL[item.value] ?? item.label}（${item.count}）` })),
])
const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'name', title: '分供方名称', minWidth: 200, fixed: 'left', slot: 'name' },
  { field: 'supplierCategory', title: '分供方类别', width: 125 },
  { field: 'taxNo', title: '统一社会信用代码', width: 190 },
  { field: 'aliases', title: '简称', width: 130, slot: 'aliases' },
  { field: 'credentialStatus', title: '资料状态', width: 110, slot: 'credentialStatus' },
  { field: 'contact', title: '主要联系人', width: 110 },
  { field: 'contactPhone', title: '联系方式', width: 130 },
  { field: 'projectCount', title: '合作项目', width: 95, align: 'right' },
  { field: 'contractAmount', title: '有效合同额', type: 'money', width: 140 },
  { field: 'paymentAmount', title: '确认实付', type: 'money', width: 130 },
  { title: '操作', type: 'action', width: 86 },
]

function currentQuery(): SupplierListQueryDTO {
  return {
    includeDemo: visibility.includeDemo,
    search: search.value,
    category: category.value === 'all' ? null : category.value,
    credentialStatus: credentialStatus.value === 'all' ? null : credentialStatus.value,
    sort: sort.value,
    page: page.value,
    pageSize: pageSize.value,
  }
}

async function load() {
  await readStore.loadList(currentQuery())
  await focusReturnAnchor()
}

async function focusReturnAnchor() {
  if (!route.hash.startsWith('#'))
    return
  const candidates = new Set<string>([route.hash.slice(1)])
  let decoded = route.hash.slice(1)
  for (let index = 0; index < 3; index += 1) {
    try {
      decoded = decodeURIComponent(decoded)
      candidates.add(decoded)
    }
    catch {
      break
    }
  }
  for (let frame = 0; frame < 4; frame += 1) {
    await nextTick()
    const anchor = [...candidates].map(id => document.getElementById(id)).find(Boolean)
    const target = anchor?.querySelector<HTMLElement>('a, button')
    if (target) {
      target.focus({ preventScroll: true })
      return
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
}

const debouncedLoad = useDebounceFn(() => {
  page.value = 1
  void load()
}, 180)

function detailTo(row: typeof rows.value[number]) {
  const returnTo = createSupplierReturnTo(row.identity, {
    search: search.value,
    category: category.value,
    credentialStatus: credentialStatus.value,
    sort: sort.value,
    page: page.value,
    pageSize: pageSize.value,
  })
  return `/base/supplier/${encodeURIComponent(row.id)}?origin=${row.dataOrigin}&returnTo=${encodeURIComponent(returnTo)}`
}

async function createSupplier() {
  if (!readPage.value?.capabilities.includes('supplier:write')) {
    error('无分供方写入权限')
    return
  }
  const selected = await typeSelect({
    title: '选择分供方类别',
    options: SUPPLIER_CATEGORIES.map(value => ({ value, label: value })),
    defaultValue: SUPPLIER_CATEGORIES[0],
    confirmLabel: '进入新建表单',
  })
  if (selected)
    void navigateTo({ path: '/base/supplier/form', query: { category: selected } })
}

function clearFilters() {
  search.value = ''
  category.value = 'all'
  credentialStatus.value = 'all'
  sort.value = 'updated-desc'
  page.value = 1
  void load()
}

watch([search, category, credentialStatus, sort], debouncedLoad)
watch(() => visibility.includeDemo, () => {
  page.value = 1
  void load()
})
watch(() => commandStore.latestWrite, () => void load(), { deep: true })
onMounted(() => void load())
onActivated(() => void load())
</script>

<template>
  <div class="grid min-w-0 gap-3">
    <StatePanel v-if="problem" :kind="problem.code === 'forbidden' ? 'forbidden' : 'error'" title="分供方列表加载失败" :description="problem.message" :action-label="problem.retryable ? '重新加载' : ''" :compact="Boolean(readPage)" @action="load" />
    <ListShell v-if="!problem || readPage" :summary="summary">
      <template #toolbar>
        <section class="panel flex min-w-0 flex-wrap items-center gap-2 p-2.5" data-supplier-list-return-fallback tabindex="-1">
          <div class="mr-auto">
            <h2 class="text-14px font-800 text-ink">
              分供方资料库
            </h2><p class="text-11px text-ink-soft">
              共 {{ readPage?.pagination.total ?? 0 }} 家；测试数据按工作区开关显示
            </p>
          </div>
          <SearchInput v-model="search" placeholder="搜索公司名、税号、简称…" :width="230" />
          <SelectFilter v-model="category" label="类别" :options="categoryOptions" :min-width="145" />
          <SelectFilter v-model="credentialStatus" label="资料" :options="credentialOptions" :min-width="140" />
          <SelectFilter v-model="sort" label="排序" :options="[{ key: 'updated-desc', label: '最近更新' }, { key: 'name-asc', label: '名称升序' }, { key: 'name-desc', label: '名称降序' }, { key: 'category-asc', label: '类别升序' }]" :min-width="125" />
          <button type="button" class="btn-secondary" :disabled="loading" @click="load">
            <span class="i-lucide-refresh-cw mr-1" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />刷新
          </button>
          <button type="button" class="btn-primary" @click="createSupplier">
            <span class="i-lucide-plus mr-1" aria-hidden="true" />新增分供方
          </button>
        </section>
      </template>
      <template #table>
        <div data-ui="supplier-list-table" class="min-w-0 max-w-full">
          <KitTable
            :columns="columns"
            :data="rows"
            :loading="loading"
            :page="{ page, pageSize, total: readPage?.pagination.total ?? 0 }"
            :page-size-options="[10, 20, 50, 100]"
            :empty="{ title: search || category !== 'all' || credentialStatus !== 'all' ? '没有符合条件的分供方' : '还没有分供方档案', description: '可调整筛选或新建正式分供方。', actionLabel: search || category !== 'all' || credentialStatus !== 'all' ? '清除筛选' : '新建分供方' }"
            row-key="identity"
            @empty-action="search || category !== 'all' || credentialStatus !== 'all' ? clearFilters() : createSupplier()"
            @page-change="({ page: nextPage, pageSize: nextSize }) => { page = nextPage; pageSize = nextSize as 10 | 20 | 50 | 100; load() }"
          >
            <template #name="{ row }">
              <div :id="`supplier-row-${row.identity}`">
                <NuxtLink :to="detailTo(row)" class="cell--link">
                  {{ row.name }}
                </NuxtLink><span class="ml-1 text-10px text-ink-faint">{{ row.dataOrigin === 'demo' ? '测试' : '正式' }}</span>
              </div>
            </template>
            <template #aliases="{ row }">
              {{ row.aliases.join('、') || '—' }}
            </template>
            <template #credentialStatus="{ row }">
              <span :class="row.credentialStatus === 'complete' ? 'chip chip-ok' : 'chip chip-warn'">{{ CREDENTIAL_STATUS_LABEL[row.credentialStatus] ?? row.credentialStatus }}</span>
            </template>
            <template #action="{ row }">
              <div class="flex justify-end">
                <NuxtLink :to="detailTo(row)" class="icon-btn" :aria-label="`查看${row.name}分供方详情`">
                  <span class="i-lucide-file-text text-14px" aria-hidden="true" />
                </NuxtLink><span class="icon-btn cursor-not-allowed opacity-40" title="请从分供方详情显式进入编辑"><span class="i-lucide-square-pen text-14px" aria-hidden="true" /></span>
              </div>
            </template>
          </KitTable>
        </div>
      </template>
    </ListShell>
  </div>
</template>
