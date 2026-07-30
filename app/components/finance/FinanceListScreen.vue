<script setup lang="ts">
import type { F3FormKind } from '~/lib/finance/forms'
import type { KitTableColumn } from '~/lib/kit/table'
import type { FinanceListRow } from '~/stores/finance'
import { F3_FORM_META, financeFormPath } from '~/lib/finance/page'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  kind: F3FormKind
}>()

const meta = computed(() => F3_FORM_META[props.kind])
const financeStore = useFinanceStore()
const { listRows, loading } = storeToRefs(financeStore)
const rows = computed<FinanceListRow[]>(() => [
  ...(listRows.value[props.kind] ?? []),
])
const search = shallowRef('')

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword)
    return rows.value
  return rows.value.filter(row =>
    [row.no, row.name, row.projectName, row.partyName, row.status]
      .some(value => value.toLowerCase().includes(keyword)),
  )
})

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: '名称/对象', minWidth: 220, fixed: 'left', slot: 'name' },
  { field: 'no', title: '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 160 },
  { field: 'partyName', title: '关联方/类型', minWidth: 180 },
  { field: 'amount', title: '金额', type: 'money', width: 140 },
  { field: 'date', title: '日期', type: 'date', width: 128 },
  { field: 'status', title: '状态', width: 110, slot: 'status' },
  { title: '操作', type: 'action', width: 72 },
]

async function load() {
  await financeStore.loadList(props.kind)
}

function openCreate() {
  void navigateTo(financeFormPath(props.kind))
}

function openEdit(row: FinanceListRow) {
  void navigateTo(financeFormPath(props.kind, row.id))
}

onMounted(() => {
  void load()
})
onActivated(() => {
  void load()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <header class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <div>
        <h1 class="text-17px font-800 text-ink">
          {{ meta.label }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          {{ meta.subtitle }}
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <SearchInput v-model="search" placeholder="搜索名称、编号、项目或关联方" :width="272" />
        <KitButton variant="secondary" :loading="loading" @click="load">
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />刷新
        </KitButton>
        <KitButton data-testid="create-finance-form" @click="openCreate">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新建{{ meta.label }}
        </KitButton>
      </div>
    </header>

    <div class="panel overflow-hidden">
      <KitTable :columns="columns" :data="filtered" :loading="loading">
        <template #name="{ row }">
          <button class="cell--link border-0 bg-transparent p-0 text-left" @click="openEdit(row)">
            {{ row.name || '未命名记录' }}
          </button>
        </template>
        <template #status="{ row }">
          <span class="chip" :class="row.status === '已确认' || row.status === 'approved' ? 'chip-ok' : 'chip-brand'">
            {{ row.status || '草稿' }}
          </span>
        </template>
        <template #action="{ row }">
          <button class="icon-btn" title="编辑" @click="openEdit(row)">
            <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
          </button>
        </template>
      </KitTable>
      <div class="border-t border-line bg-surface-2 px-4 py-2 text-right text-12px text-ink-soft">
        共 {{ filtered.length }} 条 · 金额合计
        <strong class="ml-1 font-mono text-ink">
          {{ yuan(filtered.reduce((total, row) => total + row.amount, 0)) }}
        </strong>
      </div>
    </div>
  </div>
</template>
