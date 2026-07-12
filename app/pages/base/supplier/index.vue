<script setup lang="ts">
import type { StatusTone } from '~/lib/supplier/status'
import type { Supplier } from '~/stores/supplier'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE, CREDENTIAL_STATUSES, SUPPLIER_CATEGORIES } from '~/lib/supplier/status'

const store = useSupplierStore()
const { confirm, undoToast, success, error } = useKitUI()

const searchText = ref('')
const categoryFilter = ref('all') // 'all' = 全部（reka Select 不接受空串值，用哨兵）
const statusFilter = ref('all')

const showForm = ref(false)
const editingRow = ref<Supplier | null>(null) // null = 新增

const CATEGORY_FILTER_OPTIONS = [
  { key: 'all', label: '全部类别' },
  ...SUPPLIER_CATEGORIES.map(c => ({ key: c, label: c })),
]
const STATUS_FILTER_OPTIONS = [
  { key: 'all', label: '全部状态' },
  ...CREDENTIAL_STATUSES.map(s => ({ key: s, label: CREDENTIAL_STATUS_LABEL[s] ?? s })),
]
// 语义色调 → 列表页 class（色调映射见 ~/lib/supplier/status，新增状态在那登记即可）
const TONE_CELL: Record<StatusTone, string> = {
  warn: 'cell--status-warn',
  brand: 'text-brand font-600',
  ok: 'cell--status-ok',
  danger: 'cell--status-danger',
}
function statusClass(status: string): string {
  const tone = CREDENTIAL_STATUS_TONE[status]
  return tone ? TONE_CELL[tone] : ''
}

const filtered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const cat = categoryFilter.value
  const st = statusFilter.value
  return store.list.filter((s) => {
    if (cat !== 'all' && s.supplierCategory !== cat)
      return false
    if (st !== 'all' && s.credentialStatus !== st)
      return false
    if (!q)
      return true
    return s.name.toLowerCase().includes(q)
      || s.contact.toLowerCase().includes(q)
      || s.taxNo.toLowerCase().includes(q)
      || s.supplierCategory.toLowerCase().includes(q)
  })
})

function openCreate() {
  editingRow.value = null
  showForm.value = true
}

function openEdit(row: Supplier) {
  editingRow.value = row
  showForm.value = true
}

// 删除按 ADR 0003 分两档（一律先 confirm）：
// - 无下游 → simple confirm → 软删 + 10 秒 undoToast 撤回；
// - 有下游 → cascade confirm（打分供方名 + ≥3 秒预提交挂起）→ 软删；级联已是高摩擦，刻意不再另给 undoToast。
async function handleDelete(row: Supplier) {
  const impact = await store.downstreamImpact(row.id)
  const cascade = impact.length > 0
  const ok = await confirm(cascade
    ? {
        variant: 'cascade',
        title: '删除分供方',
        message: `“${row.name}”挂有下游数据，删除后其下游数据一并隐藏。`,
        requireTyping: row.name,
        impact,
        confirmLabel: '删除',
      }
    : {
        variant: 'simple',
        title: '删除分供方',
        message: `确认删除分供方「${row.name}」？删除后可在 10 秒内撤回。`,
        confirmLabel: '删除',
      })
  if (!ok)
    return

  const logId = await store.remove(row.id)
  if (!logId) {
    error('删除失败：分供方不存在或已删除')
    return
  }
  if (cascade) {
    success(`已删除「${row.name}」及其下游数据`)
  }
  else {
    undoToast(`已删除「${row.name}」`, () => store.undo(logId))
  }
}

onMounted(() => store.load())
</script>

<template>
  <div>
    <DataListToolbar
      title="分供方"
      :count="filtered.length"
      @search="v => searchText = v"
      @create="openCreate"
    />

    <!-- 类别 / 资料状态筛选 -->
    <div class="flex items-center gap-2 pb-2.5 px-1">
      <SelectFilter
        v-model="categoryFilter"
        label="类别"
        :options="CATEGORY_FILTER_OPTIONS"
        placeholder="全部类别"
      />
      <SelectFilter
        v-model="statusFilter"
        label="资料状态"
        :options="STATUS_FILTER_OPTIONS"
        placeholder="全部状态"
      />
    </div>

    <div class="border border-line">
      <vxe-table
        :data="filtered"
        :loading="store.loading"
        border
        show-overflow="title"
        max-height="640"
        :row-config="{ isHover: true, keyField: 'id' }"
        :column-config="{ resizable: true }"
      >
        <vxe-column type="seq" title="#" width="52" fixed="left" />
        <vxe-column field="name" title="分供方名称" min-width="180" fixed="left">
          <template #default="{ row }">
            <NuxtLink :to="`/base/supplier/${row.id}`" class="cell--link">
              {{ row.name }}
            </NuxtLink>
          </template>
        </vxe-column>
        <vxe-column field="supplierCategory" title="分供方类别" width="110" />
        <vxe-column field="taxNo" title="税号" width="180" />
        <vxe-column field="aliases" title="简称" width="100">
          <template #default="{ row }">
            {{ row.aliases?.[0] ?? '' }}
          </template>
        </vxe-column>
        <vxe-column field="address" title="详细地址" min-width="150" />
        <vxe-column field="contact" title="主要联系人" width="100" />
        <vxe-column field="contactPhone" title="联系方式" width="120" />
        <vxe-column field="credentialStatus" title="资料状态" width="90">
          <template #default="{ row }">
            <span :class="statusClass(row.credentialStatus)">
              {{ CREDENTIAL_STATUS_LABEL[row.credentialStatus] || row.credentialStatus }}
            </span>
          </template>
        </vxe-column>
        <vxe-column title="操作" width="120" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center gap-1">
              <NuxtLink :to="`/base/supplier/${row.id}`" class="icon-btn" title="详情">
                <span class="i-lucide-file-text text-14px" />
              </NuxtLink>
              <button class="icon-btn" title="编辑" @click="openEdit(row)">
                <span class="i-lucide-square-pen text-14px" />
              </button>
              <button class="icon-btn-danger" title="删除" @click="handleDelete(row)">
                <span class="i-lucide-trash-2 text-14px" />
              </button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>

    <!-- 新增/编辑表单（列表页与详情页共用同一组件） -->
    <SupplierFormDialog v-model:open="showForm" :supplier="editingRow" />
  </div>
</template>
