<script setup lang="ts">
import type { StatusTone } from '~/lib/project/status'
import type { Project } from '~/stores/project'
import { PROJECT_STATUS_TONE, PROJECT_STATUSES } from '~/lib/project/status'

const store = useProjectStore()
const { confirm, undoToast, success, error } = useKitUI()

const searchText = ref('')
const statusFilter = ref('all') // 'all' = 全部（reka Select 不接受空串值，用哨兵）

const showForm = ref(false)
const editingRow = ref<Project | null>(null) // null = 新增

const STATUS_FILTER_OPTIONS = [
  { key: 'all', label: '全部状态' },
  ...PROJECT_STATUSES.map(s => ({ key: s, label: s })),
]
// 语义色调 → 列表页 class（色调映射见 ~/lib/project/status，新增状态在那登记即可）
const TONE_CELL: Record<StatusTone, string> = {
  warn: 'cell--status-warn',
  brand: 'text-brand font-600',
  muted: 'text-ink-faint font-600',
  ok: 'cell--status-ok',
}
function statusClass(status: string): string {
  const tone = PROJECT_STATUS_TONE[status]
  return tone ? TONE_CELL[tone] : ''
}

const filtered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const st = statusFilter.value
  return store.list.filter((p) => {
    if (st !== 'all' && p.status !== st)
      return false
    if (!q)
      return true
    return p.name.toLowerCase().includes(q)
      || p.address.toLowerCase().includes(q)
      || p.manager.toLowerCase().includes(q)
  })
})

function openCreate() {
  editingRow.value = null
  showForm.value = true
}

function openEdit(row: Project) {
  editingRow.value = row
  showForm.value = true
}

// 删除按 ADR 0003 分两档（一律先 confirm）：
// - 无下游 → simple confirm → 软删 + 10 秒 undoToast 撤回；
// - 有下游 → cascade confirm（打项目名 + ≥3 秒预提交挂起）→ 软删；级联已是高摩擦，刻意不再另给 undoToast。
async function handleDelete(row: Project) {
  const impact = await store.downstreamImpact(row.id)
  const cascade = impact.length > 0
  const ok = await confirm(cascade
    ? {
        variant: 'cascade',
        title: '删除项目',
        message: `“${row.name}”挂有下游数据，删除后其下游数据一并隐藏。`,
        requireTyping: row.name,
        impact,
        confirmLabel: '删除',
      }
    : {
        variant: 'simple',
        title: '删除项目',
        message: `确认删除项目「${row.name}」？删除后可在 10 秒内撤回。`,
        confirmLabel: '删除',
      })
  if (!ok)
    return

  const logId = await store.remove(row.id)
  if (!logId) {
    error('删除失败：项目不存在或已删除')
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
      title="施工项目"
      :count="filtered.length"
      @search="v => searchText = v"
      @create="openCreate"
    />

    <!-- 状态筛选 -->
    <div class="flex items-center gap-2 pb-2.5 px-1">
      <SelectFilter
        v-model="statusFilter"
        label="状态"
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
        <vxe-column field="name" title="项目名称" min-width="160" fixed="left">
          <template #default="{ row }">
            <NuxtLink :to="`/project/${row.id}`" class="cell--link">
              {{ row.name }}
            </NuxtLink>
          </template>
        </vxe-column>
        <vxe-column field="status" title="状态" width="90">
          <template #default="{ row }">
            <span :class="statusClass(row.status)">{{ row.status }}</span>
          </template>
        </vxe-column>
        <vxe-column field="address" title="项目地址" min-width="130" />
        <vxe-column field="startDate" title="开工日期" width="110" />
        <vxe-column field="developer" title="建设单位" min-width="120" />
        <vxe-column field="manager" title="项目经理" width="90" />
        <vxe-column title="操作" width="130" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center gap-1">
              <NuxtLink :to="`/project/${row.id}`" class="icon-btn" title="详情">
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
    <ProjectFormDialog v-model:open="showForm" :project="editingRow" />
  </div>
</template>
