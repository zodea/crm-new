<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import KitTable from '~/components/ui/KitTable.vue'
import ListShell from '~/components/ui/ListShell.vue'
import StatePanel from '~/components/ui/StatePanel.vue'

const columns: KitTableColumn[] = [
  { field: 'draft.partyName', title: '报价方原文', minWidth: 220, slot: 'party' },
  { field: 'draft.quotationDate', title: '报价日期', type: 'date', slot: 'date' },
  { field: 'draft.scope', title: '适用范围', minWidth: 120, slot: 'scope' },
  { field: 'draft.lines', title: '材料行', width: 76, align: 'right', slot: 'lineCount' },
  { field: 'version', title: '版本', minWidth: 72 },
  { title: '操作', type: 'action', width: 72, align: 'center' },
]
const scopeLabels = {
  general: '通用报价',
  project: '明确项目',
  unknown: '范围未知',
}

const store = useMaterialQuotationStore()
const canWrite = computed(() => store.snapshot?.capabilities.includes('material-quotation:write') ?? false)
const canImport = computed(() => store.snapshot?.capabilities.includes('core:migration:write') ?? false)
let active = true
async function load() {
  try {
    await store.load()
  }
  catch {
  }
}
onMounted(load)
onDeactivated(() => {
  active = false
  store.invalidate()
})
onBeforeUnmount(() => {
  active = false
  store.invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
useTabTitle('材料报价')
</script>

<template>
  <ListShell continuous class="m-4">
    <template #heading>
      <div class="min-w-0">
        <h1 class="m-0 text-16px font-700 text-ink">
          材料报价
        </h1>
        <p class="m-0 mt-1 text-13px text-ink-soft">
          独立保存报价原文、适用条件和原件。未建档报价方不会自动成为分供方。
        </p>
      </div>
    </template>
    <template #actions>
      <NuxtLink v-if="canWrite" to="/material/quotations/form" class="btn-primary">
        新增报价
      </NuxtLink>
      <NuxtLink v-if="canImport" to="/material/quotations/import" class="btn-secondary">
        核验本地报价迁入
      </NuxtLink>
    </template>
    <template #table>
      <StatePanel v-if="store.loading" kind="loading" title="正在读取报价" />
      <StatePanel v-else-if="store.error" kind="error" title="报价读取失败" :description="store.error" action-label="重试" @action="load" />
      <template v-else-if="store.snapshot">
        <p v-if="store.snapshot.meta.authorizedScope.coverage !== 'complete'" class="m-0 border-t border-line px-3 py-2 text-13px text-ink-soft">
          清单仅包含本次有权读取的报价，不能作为全部报价数量。
        </p>
        <KitTable
          :columns="columns"
          :data="store.snapshot.records"
          :empty="{ title: '当前可读取范围内暂无报价' }"
          role="region"
          aria-label="报价清单横向滚动区域"
        >
          <template #party="{ row }">
            <div class="min-w-0 grid justify-items-start leading-tight">
              <NuxtLink :to="`/material/quotations/${row.id}`" class="max-w-full truncate text-brand" :title="row.draft.partyName">
                {{ row.draft.partyName }}
              </NuxtLink>
              <KitStatusTag :tone="row.draft.supplierId ? 'ok' : 'neutral'">
                {{ row.draft.supplierId ? '已明确关联分供方' : '未关联目录身份' }}
              </KitStatusTag>
            </div>
          </template>
          <template #date="{ row }">
            {{ row.draft.quotationDate ?? '未知' }}
          </template>
          <template #scope="{ row }">
            {{ scopeLabels[row.draft.scope] }}
          </template>
          <template #lineCount="{ row }">
            {{ row.draft.lines.length }}
          </template>
          <template #action="{ row }">
            <NuxtLink v-if="canWrite" :to="`/material/quotations/form/${row.id}`" class="icon-btn" title="编辑" aria-label="编辑">
              <span class="i-lucide-pencil" aria-hidden="true" />
            </NuxtLink>
          </template>
        </KitTable>
      </template>
    </template>
  </ListShell>
</template>
