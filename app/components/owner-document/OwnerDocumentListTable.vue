<script setup lang="ts">
import type { RowActionItem } from '~/components/ui/RowActionMenu.vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { OwnerDocumentKind, OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { computed } from 'vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import { ownerDocumentStatusLabelForList, ownerDocumentStatusTone, ownerDocumentTypeLabel } from '~/lib/owner-document/list'
import { OWNER_DOCUMENT_META, ownerDocumentDetailPath, ownerDocumentFormPath } from '~/lib/owner-document/page'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  kind: OwnerDocumentKind
  acceptanceVariant: 'acceptance' | 'warranty'
  centralReadOnly: boolean
  columns: KitTableColumn[]
  rows: OwnerDocumentListRecord[]
  busy: boolean
  loading: boolean
  page: { page: number, pageSize: number, total: number }
  empty: { title: string, description: string, actionLabel: string }
}>()

const emit = defineEmits<{
  pageChange: [page: { page: number, pageSize: number }]
  emptyAction: []
  openDetail: [row: OwnerDocumentListRecord]
  rowAction: [action: string, row: OwnerDocumentListRecord]
}>()

const label = computed(() => OWNER_DOCUMENT_META[props.kind].label)
const minWidth = computed(() =>
  props.kind === 'sub_settlement' && !props.rows.length
    ? '100%'
    : `${props.columns.reduce((total, column) => total + (column.width ?? column.minWidth ?? 120), 0)}px`,
)

function centralContractTarget(row: OwnerDocumentListRecord): string | null {
  if (!props.centralReadOnly || !row.contractNavigation)
    return null
  const result = resolveNavigationTarget(row.contractNavigation)
  return result.state === 'resolved' ? result.to : null
}

function rowActions(row: OwnerDocumentListRecord): RowActionItem[] {
  if (props.centralReadOnly)
    return [{ key: 'edit', label: '查看详情', icon: 'i-lucide-eye' }]
  const canDelete = ownerDocumentStatusIsEditable(row.status)
  return [
    { key: 'edit', label: '查看/编辑', icon: 'i-lucide-square-pen' },
    {
      key: 'delete',
      label: canDelete ? '删除' : '当前状态不可删除',
      icon: 'i-lucide-trash-2',
      tone: 'danger',
      disabled: !canDelete,
    },
  ]
}
</script>

<template>
  <div
    data-ui="owner-document-table"
    :aria-busy="busy"
    role="region"
    :aria-label="`${label}列表，可横向滚动查看完整列`"
    tabindex="0"
    class="max-w-full overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/35"
  >
    <KitTable
      :columns="columns"
      :data="rows"
      :loading="loading"
      :page="page"
      :empty="empty"
      :style="{ minWidth, maxWidth: 'none' }"
      @page-change="emit('pageChange', $event)"
      @empty-action="emit('emptyAction')"
    >
      <template #document="{ row }">
        <NuxtLink
          v-if="centralReadOnly"
          :id="`owner-document-row-real:${kind}:${row.id}`"
          :to="ownerDocumentDetailPath(kind, row.id, 'real', row.viewVariant ?? acceptanceVariant)"
          class="cell--link whitespace-nowrap font-mono"
          :title="row.no || row.name"
          @click.prevent="emit('openDetail', row)"
        >
          {{ row.no || '未编号' }}
        </NuxtLink>
        <NuxtLink
          v-else
          :to="ownerDocumentFormPath(kind, row.id)"
          class="cell--link whitespace-nowrap font-mono"
          :title="row.no || row.name"
        >
          {{ row.no || '未编号' }}
        </NuxtLink>
      </template>
      <template #project="{ row }">
        <EntityLink :id="row.projectId" type="project" :label="row.projectName" :intent="row.projectNavigation" />
      </template>
      <template #contract="{ row }">
        <NuxtLink v-if="centralContractTarget(row)" :to="centralContractTarget(row)!" class="cell--link">
          {{ row.contractName }}
        </NuxtLink>
        <EntityLink v-else :id="row.contractId" type="contract" :label="row.contractName" />
      </template>
      <template #supplier="{ row }">
        <EntityLink
          :id="row.supplierId"
          type="supplier"
          :label="row.supplierName || row.crewName"
          :intent="row.supplierNavigation"
        />
      </template>
      <template #type="{ row }">
        {{ ownerDocumentTypeLabel(kind, row.type) || '—' }}
      </template>
      <template #negativeAmount="{ row }">
        <span class="whitespace-nowrap font-mono font-700 text-danger">
          {{ row.amount > 0 ? `-${yuan(row.amount)}` : yuan(row.amount) }}
        </span>
      </template>
      <template #status="{ row }">
        <KitStatusTag :tone="ownerDocumentStatusTone(kind, row.status)">
          {{ ownerDocumentStatusLabelForList(kind, row.status) }}
        </KitStatusTag>
      </template>
      <template #action="{ row }">
        <RowActionMenu
          :items="rowActions(row)"
          :label="`${row.no || row.name}${label}操作`"
          @select="emit('rowAction', $event, row)"
        />
      </template>
    </KitTable>
  </div>
</template>
