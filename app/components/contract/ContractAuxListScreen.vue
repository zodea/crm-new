<script setup lang="ts">
import type { F2FormKind } from '~/lib/contract/forms'
import type { KitTableColumn } from '~/lib/kit/table'
import type { ContractAuxRow } from '~/stores/contract'
import { F2_FORM_META, formPath } from '~/lib/contract/page'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  kind: 'other_expense' | 'company_expense' | 'other_settlement'
}>()

const contractStore = useContractStore()
const { confirm, undoToast, error } = useKitUI()
const meta = computed(() => F2_FORM_META[props.kind])
const rows = computed(() => contractStore.auxByKind(props.kind))
const loading = computed(() => contractStore.loading)
const search = shallowRef('')

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword)
    return rows.value
  return rows.value.filter(row =>
    [row.no, row.name, row.projectName, row.partyName]
      .some(value => value.toLowerCase().includes(keyword)),
  )
})

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: '名称', minWidth: 220, fixed: 'left', slot: 'name' },
  { field: 'no', title: '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 160 },
  { field: 'partyName', title: '关联方/源合同', minWidth: 200 },
  { field: 'amount', title: '含税金额', type: 'money', width: 140 },
  { field: 'date', title: '签订/结算日期', type: 'date', width: 128 },
  { field: 'status', title: '状态', width: 100, slot: 'status' },
  { title: '操作', type: 'action', width: 104 },
]

async function load() {
  await contractStore.loadAux(props.kind)
}

function openCreate() {
  void navigateTo(formPath(props.kind))
}

function openEdit(row: ContractAuxRow) {
  void navigateTo(formPath(props.kind, row.id))
}

async function handleDelete(row: ContractAuxRow) {
  const accepted = await confirm({
    variant: 'simple',
    title: `删除${meta.value.label}`,
    message: `确认删除「${row.name}」？有关联付款分摊或下游单据时会阻止删除。`,
    confirmLabel: '删除',
  })
  if (!accepted)
    return
  try {
    const logId = await contractStore.removeForm(props.kind as F2FormKind, row.id)
    if (!logId) {
      error('记录不存在或已删除')
      return
    }
    undoToast(`已删除「${row.name}」`, async () => {
      await contractStore.undoForm(props.kind, logId)
    })
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : '删除失败')
  }
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
          {{ meta.listLabel }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          {{ meta.subtitle }}
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <SearchInput v-model="search" placeholder="搜索名称、编号或关联方" class="w-64" />
        <KitButton variant="secondary" :loading="loading" @click="load">
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />
          刷新
        </KitButton>
        <KitButton data-testid="create-aux-contract" @click="openCreate">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />
          新建{{ meta.label }}
        </KitButton>
      </div>
    </header>

    <div class="panel overflow-hidden">
      <KitTable :columns="columns" :data="filtered" :loading="loading">
        <template #name="{ row }">
          <button class="cell--link border-0 bg-transparent p-0 text-left" @click="openEdit(row)">
            {{ row.name }}
          </button>
        </template>
        <template #status="{ row }">
          <span class="chip" :class="row.status === '审批中' ? 'chip-ok' : 'chip-brand'">
            {{ row.status }}
          </span>
        </template>
        <template #action="{ row }">
          <div class="flex items-center gap-1">
            <button class="icon-btn" title="编辑" @click="openEdit(row)">
              <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
            </button>
            <button class="icon-btn-danger" title="删除" @click="handleDelete(row)">
              <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
            </button>
          </div>
        </template>
      </KitTable>
      <div class="border-t border-line bg-surface-2 px-4 py-2 text-right text-12px text-ink-soft">
        共 {{ filtered.length }} 条 · 金额合计
        <strong class="ml-1 font-mono text-ink">
          {{ yuan(filtered.reduce((total, row) => total + Number(row.amount || 0), 0)) }}
        </strong>
      </div>
    </div>
  </div>
</template>
