<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { OwnerDocumentKind, OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { OWNER_DOCUMENT_META, ownerDocumentFormPath } from '~/lib/owner-document/page'

const props = defineProps<{
  kind: OwnerDocumentKind
}>()

const store = useOwnerDocumentStore()
const { confirm, undoToast, error } = useKitUI()
const meta = computed(() => OWNER_DOCUMENT_META[props.kind])
const search = shallowRef('')

const records = computed(() =>
  [...(store.records[props.kind] ?? [])] as unknown as OwnerDocumentListRecord[],
)
const filtered = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase('zh-CN')
  if (!keyword)
    return records.value
  return records.value.filter(row =>
    [row.no, row.name, row.projectName, row.counterpartyName, statusLabel(row.status)]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)),
  )
})

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: '单据名称/事由', minWidth: 230, fixed: 'left', slot: 'name' },
  { field: 'no', title: '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 170 },
  { field: 'counterpartyName', title: '合同/分供方/班组', minWidth: 180 },
  { field: 'amount', title: '金额', width: 138, align: 'right', slot: 'amount' },
  { field: 'date', title: '日期', type: 'date', width: 126 },
  { field: 'status', title: '状态', width: 110, slot: 'status' },
  { title: '操作', type: 'action', width: 104 },
]

function statusLabel(status: string): string {
  return {
    draft: '草稿',
    submitted: '已提交',
    adjusted: '已申报',
    reported: '已申报',
    exported: '已审定',
    audited: '已审定',
    approved: '已签证',
    confirmed: '已确认',
    pending: '待抵扣',
    repairing: '整改中',
    repaired_self: '自行整改',
    repaired_other: '代为整改',
    deducted: '已抵扣',
    rejected: '已退回',
  }[status] ?? status
}

function isDraftStatus(status: string): boolean {
  return status === 'draft' || status === 'rejected'
}

async function load() {
  await store.loadKind(props.kind)
}

function openCreate() {
  void navigateTo(ownerDocumentFormPath(props.kind))
}

function openEdit(row: OwnerDocumentListRecord) {
  void navigateTo(ownerDocumentFormPath(props.kind, row.id))
}

async function handleDelete(row: OwnerDocumentListRecord) {
  const accepted = await confirm({
    variant: 'simple',
    title: `删除${meta.value.label}`,
    message: `确认删除「${row.no || row.name}」？关联明细将随父单据一并隐藏。`,
    confirmLabel: '删除',
  })
  if (!accepted)
    return
  try {
    const logId = await store.removeForm(props.kind, row.id)
    if (!logId) {
      error('记录不存在或已删除')
      return
    }
    undoToast(`已删除「${row.no || row.name}」`, async () => {
      await store.restoreForm(props.kind, row.id)
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
          {{ meta.label }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          {{ meta.subtitle }}
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <SearchInput v-model="search" placeholder="搜索编号、项目或业务对象" class="w-72" />
        <KitButton variant="secondary" :loading="store.loading" @click="load">
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />刷新
        </KitButton>
        <KitButton data-testid="create-owner-document" @click="openCreate">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新建{{ meta.label }}
        </KitButton>
      </div>
    </header>

    <div class="panel overflow-hidden">
      <KitTable :columns="columns" :data="filtered" :loading="store.loading">
        <template #name="{ row }">
          <button class="cell--link border-0 bg-transparent p-0 text-left" @click="openEdit(row)">
            {{ row.name || meta.label }}
          </button>
        </template>
        <template #amount="{ row }">
          <span class="font-mono font-700">¥{{ Number(row.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}</span>
        </template>
        <template #status="{ row }">
          <span class="chip" :class="isDraftStatus(row.status) ? 'chip-brand' : 'chip-ok'">
            {{ statusLabel(row.status) }}
          </span>
        </template>
        <template #action="{ row }">
          <div class="flex items-center gap-1">
            <button class="icon-btn" title="查看/编辑" @click="openEdit(row)">
              <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
            </button>
            <button
              class="icon-btn-danger"
              :title="row.status === 'approved' ? '已签证变更请在 BOQ 工作区执行级联更正' : '删除'"
              :disabled="row.status === 'approved'"
              @click="handleDelete(row)"
            >
              <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
            </button>
          </div>
        </template>
      </KitTable>
      <div class="border-t border-line bg-surface-2 px-4 py-2 text-right text-12px text-ink-soft">
        共 {{ filtered.length }} 条 · 当前金额合计
        <strong class="ml-1 font-mono text-ink">
          ¥{{ filtered.reduce((total, row) => total + row.amount, 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
        </strong>
      </div>
    </div>
  </div>
</template>
