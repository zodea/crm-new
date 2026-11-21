<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { OtherSettlementDTO } from '~/lib/other-settlement/contract'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'
import { enumFilterValues } from '~/lib/kit/enum-filter'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { canonicalOtherSettlementStatus, OTHER_SETTLEMENT_AMOUNT_LABELS, OTHER_SETTLEMENT_PATH, OTHER_SETTLEMENT_STATUS_LABELS } from '~/lib/other-settlement/contract'

const route = useRoute()
const root = useTemplateRef<HTMLElement>('root')
const navigation = useOtherSettlementNavigation(root)
const repository = useNuxtApp().$repositories.otherSettlements
const { data: page, shellState, problem, load } = useAuxiliaryContractRead(
  () => repository.list({ ...route.query }),
  undefined,
  { snapshotKey: () => JSON.stringify([route.query.origin ?? 'real']) },
)
const search = shallowRef(String(route.query.search ?? ''))
const status = computed({ get: () => [...new Set(enumFilterValues(route.query.status).map(canonicalOtherSettlementStatus))], set: (value: string[]) => void filter({ status: value.length ? value : undefined }) })
const project = computed({ get: () => String(route.query.projectId ?? ''), set: value => void filter({ projectId: value || undefined }) })
const statuses = Object.entries(OTHER_SETTLEMENT_STATUS_LABELS).map(([key, label]) => ({ key, label }))
const columns: KitTableColumn[] = [
  { field: 'name', title: '结算名称', width: 210, slot: 'name' },
  { field: 'no', title: '结算单号', width: 150 },
  { field: 'date', title: '结算日期', width: 120 },
  { field: 'type', title: '结算类型', width: 120 },
  { field: 'project', title: '项目名称', width: 170 },
  { field: 'contractName', title: '合同名称', width: 210 },
  { field: 'supplier', title: '分供方', width: 170 },
  ...(['total', 'deductions', 'net', 'applied', 'applicable', 'paid', 'unpaid'] as const).map(key => ({ field: key, title: OTHER_SETTLEMENT_AMOUNT_LABELS[key], width: 160 })),
  { field: 'status', title: '状态', width: 110 },
  { field: 'business', title: '业务类型', width: 140 },
  { field: 'attachmentCount', title: '附件数量', width: 100 },
  ...([['createdBy', '创建人'], ['createdAt', '创建时间'], ['updatedBy', '修改人'], ['updatedAt', '修改时间']] as const).map(([field, title]) => ({ field, title, width: 170 })),
  { field: 'action', title: '操作', width: 76, fixed: 'right' as const, slot: 'action' },
]
const rows = computed(() => page.value?.items.map(row => ({ id: row.id, source: row, name: row.draft.name || '未命名结算', no: row.draft.no || '未记录', date: row.draft.settlementDate || '未记录', type: row.draft.settlementType || '未记录', project: row.project.label || '关系不可用', contractName: row.contract.label || '关系不可用', supplier: row.supplier.label || '关系不可用', ...Object.fromEntries(Object.entries(row.amounts).map(([key, value]) => [key, auxiliaryMoney(value)])), status: OTHER_SETTLEMENT_STATUS_LABELS[canonicalOtherSettlementStatus(row.draft.status ?? '')] || '未记录', business: '其他支出结算', attachmentCount: row.attachmentCount, ...Object.fromEntries(Object.entries(row.audit).map(([key, value]) => [key, value || '未记录'])) })) ?? [])
const canWrite = computed(() => page.value?.capabilities.includes('other-settlement:write'))
const hasFilters = computed(() => ['search', 'projectId', 'contractId', 'supplierId'].some(key => route.query[key]) || status.value.length > 0)
const fetchProjects = async (keyword: string) => page.value?.projectOptions.filter(p => p.label.includes(keyword)) ?? []
async function filter(patch: Record<string, string | string[] | undefined>) {
  await navigateTo({ path: route.path, query: { ...route.query, ...patch, page: undefined } }, { replace: true })
}
function clear() {
  search.value = ''
  void navigateTo({ path: route.path, query: { returnTo: route.query.returnTo, origin: 'real' } }, { replace: true })
}
function target(row: OtherSettlementDTO) {
  const result = resolveNavigationTarget(row.navigation, { returnTo: navigation.context(`other-settlement-${row.id}`) })
  return result.state === 'resolved' ? result.to : undefined
}
async function refresh() {
  if (route.path === OTHER_SETTLEMENT_PATH) {
    await load()
    await navigation.restore()
  }
}
watch(() => route.fullPath, () => {
  search.value = String(route.query.search ?? '')
  void refresh()
}, { immediate: true })
onActivated(refresh)
useTabTitle(() => '其他支出结算')
</script>

<template>
  <div ref="root" class="flex min-w-0 flex-col gap-3" data-testid="other-settlement-list">
    <TargetCostSourceReturn />
    <header class="panel flex min-w-0 flex-wrap items-center gap-2 p-3">
      <h1 class="m-0 mr-auto text-15px font-800">
        其他支出结算
      </h1>
      <KitMultiSelectFilter v-model="status" :options="statuses" label="状态" />
      <LookupSelect v-model="project" :fetch="fetchProjects" placeholder="筛选项目" class="w-44 max-w-full" />
      <form class="flex min-w-0 max-w-full flex-wrap gap-2" @submit.prevent="filter({ search: search || undefined })">
        <input v-model="search" class="field-input min-w-0 max-w-full" type="search" placeholder="搜索结算名称 / 单号 / 合同" aria-label="搜索结算名称 / 单号 / 合同">
        <KitButton type="submit">
          搜索
        </KitButton>
      </form>
      <KitButton aria-label="刷新结算列表" @click="refresh">
        刷新
      </KitButton>
      <KitButton v-if="canWrite" variant="primary" @click="navigateTo({ path: `${OTHER_SETTLEMENT_PATH}/form`, query: { contractId: route.query.contractId, returnTo: route.fullPath } })">
        新建结算
      </KitButton>
      <NuxtLink v-if="canWrite && page?.capabilities.includes('core:migration:write')" :to="`${OTHER_SETTLEMENT_PATH}/import`" class="text-13px text-brand underline">
        原结算历史迁入
      </NuxtLink>
    </header>
    <NuxtLink v-if="validateAuxiliaryReturnTo(route.query.returnTo)" :to="validateAuxiliaryReturnTo(route.query.returnTo)!" class="text-13px text-brand">
      返回来源
    </NuxtLink>
    <KitButton v-if="hasFilters" class="self-start" @click="clear">
      清除筛选
    </KitButton>
    <p v-if="problem && page" role="alert" class="m-0 rounded-sm bg-danger-soft p-3 text-12px text-danger">
      {{ problem.message }}；当前保留上一次成功读取的列表。
      <button v-if="problem.retryable" type="button" class="ml-2 underline" @click="refresh">
        重试
      </button>
    </p>
    <StatePanel v-if="problem && !page" :kind="shellState === 'forbidden' ? 'forbidden' : 'error'" :title="problem.message" :action-label="problem.retryable ? '重新加载' : ''" @action="refresh" />
    <div v-else class="grid min-w-0 gap-3 lg:grid-cols-[150px_minmax(0,1fr)]" :aria-busy="shellState === 'loading'">
      <aside class="panel hidden p-3 text-13px lg:block">
        <p class="text-ink-soft">
          业务类型
        </p><p class="rounded bg-brand-soft p-2 font-700 text-brand">
          其他支出结算
        </p>
      </aside>
      <div class="relative min-w-0">
        <span v-if="shellState === 'loading' && page" role="status" class="pointer-events-none absolute right-3 top-1 z-1 rounded-sm bg-panel px-2 py-1 text-12px text-ink-soft">正在更新列表…</span>
        <KitTable :columns="columns" :data="rows" :loading="shellState === 'loading' && !page" :page="page?.pagination ?? { page: 1, pageSize: 20, total: 0 }" :empty="{ title: hasFilters ? '没有符合条件的结算' : '暂无其他支出结算', description: hasFilters ? '请调整筛选范围。' : '从真实其他支出合同建立结算。', actionLabel: hasFilters ? '清除筛选' : '' }" @empty-action="clear" @page-change="navigateTo({ path: route.path, query: { ...route.query, page: $event.page, pageSize: $event.pageSize } }, { replace: true })">
          <template #name="{ row }">
            <NuxtLink :id="`other-settlement-${row.id}`" :to="target(row.source)" class="cell--link" @click="navigation.remember(`other-settlement-${row.id}`)">
              {{ row.name }}
            </NuxtLink>
          </template>
          <template #action="{ row }">
            <RowActionMenu :label="`${row.name}操作`" :items="[{ key: 'view', label: '查看详情', icon: 'i-lucide-eye' }]" @select="navigateTo(target(row.source)!)" />
          </template>
        </KitTable>
        <p class="m-0 border border-line bg-surface-2 p-3 text-right text-12px">
          当前筛选 · {{ page?.summary.count ?? 0 }} 份 · 含税结算合计 <strong class="font-mono">{{ auxiliaryMoney(page?.summary.amount ?? null) }}</strong>
        </p>
      </div>
    </div>
  </div>
</template>
