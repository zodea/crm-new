<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import { yuan } from '~/lib/util/money'

const route = useRoute()
const store = useDeliveryRecordStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const { confirm, undoToast, error } = useKitUI()

const recordId = computed(() => String(route.params.id))
const record = computed(() => store.byId(recordId.value))
const project = computed(() => record.value ? projectStore.byId(record.value.projectId) : undefined)
const supplier = computed(() => record.value?.supplierId ? supplierStore.byId(record.value.supplierId) : undefined)
const loaded = shallowRef(false)

useTabTitle(() => record.value?.orderNo ? `送货单 ${record.value.orderNo}` : record.value ? '未编号送货单' : undefined)

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq' },
  { field: 'materialName', title: '材料名称', minWidth: 220 },
  { field: 'spec', title: '规格型号', minWidth: 160 },
  { field: 'unit', title: '单位', width: 80 },
  { field: 'qty', title: '数量', width: 110, align: 'right' },
  { field: 'unitPrice', title: '单价', type: 'money', width: 130 },
  { field: 'amount', title: '金额', type: 'money', width: 140 },
  { field: 'note', title: '备注', minWidth: 160 },
]

async function handleDelete() {
  if (!record.value)
    return
  const label = record.value.orderNo || record.value.id
  const ok = await confirm({
    variant: 'simple',
    title: '删除送货单',
    message: `确认删除送货单「${label}」？材料明细会随送货单一同隐藏，10 秒内可撤回。`,
    confirmLabel: '删除',
  })
  if (!ok)
    return
  const logId = await store.remove(record.value.id)
  if (!logId) {
    error('删除失败：送货单不存在或已删除')
    return
  }
  undoToast(`已删除送货单「${label}」`, () => store.undo(logId))
  await navigateTo('/material/delivery/archive')
}

async function refresh() {
  try {
    await Promise.all([store.load(), projectStore.load(), supplierStore.load()])
  }
  finally {
    loaded.value = true
  }
}

onMounted(refresh)
</script>

<template>
  <div v-if="record" class="delivery-record-detail flex min-w-0 flex-col gap-4">
    <div class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <NuxtLink to="/material/delivery/archive" class="icon-btn" title="返回归档库">
        <span class="i-lucide-arrow-left text-14px" />
      </NuxtLink>
      <div class="min-w-0 flex-1">
        <div class="text-17px font-800 text-ink">
          {{ record.orderNo || '未编号送货单' }}
        </div>
        <div class="mt-0.5 text-12px text-ink-faint">
          {{ project?.name ?? record.projectId }} · {{ supplier?.name ?? '未区分分供方' }}
        </div>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <NuxtLink :to="`/material/delivery/archive/form/${record.id}`" class="btn-secondary">
          <span class="i-lucide-square-pen mr-1 text-13px" /> 编辑
        </NuxtLink>
        <button class="btn-danger" @click="handleDelete">
          <span class="i-lucide-trash-2 mr-1 text-13px" /> 删除
        </button>
      </div>
    </div>

    <DeliveryRecordSummary
      :delivery-date="record.deliveryDate"
      :line-count="record.lines.length"
      :total-amount="record.totalAmount"
      :archived="record.archived"
      :stored="record.stored"
    />

    <div class="delivery-record-layout grid min-w-0 items-start gap-4">
      <DeliveryRecordSourcePanel
        :record-id="record.id"
        min-height="clamp(22rem, 60dvh, 42.5rem)"
        class="delivery-record-source self-start"
      />

      <div class="flex min-w-0 flex-col gap-4">
        <div class="panel px-4 py-3">
          <SectionHeader title="单据信息" subtitle="右侧结构化数据应与左侧原件逐项核对" />
          <div class="delivery-record-info mt-2 grid gap-x-8">
            <div class="detail-row">
              <span class="detail-label">所属项目</span><NuxtLink :to="`/project/${record.projectId}`" class="cell--link">
                {{ project?.name ?? record.projectId }}
              </NuxtLink>
            </div>
            <div class="detail-row">
              <span class="detail-label">分供方</span><NuxtLink v-if="record.supplierId" :to="`/base/supplier/${record.supplierId}`" class="cell--link">
                {{ supplier?.name ?? record.supplierId }}
              </NuxtLink><span v-else class="text-warn-ink">未区分分供方</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">送货单号</span><span class="font-mono">{{ record.orderNo || '—' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">送货日期</span><span class="font-mono">{{ record.deliveryDate || '—' }}</span>
            </div>
            <div class="detail-row delivery-record-info__full">
              <span class="detail-label">备注</span><span>{{ record.note || '—' }}</span>
            </div>
          </div>
        </div>

        <div>
          <SectionHeader title="材料明细" :subtitle="`共 ${record.lines.length} 项 · ${yuan(record.totalAmount)}`" />
          <KitTable class="mt-2" :columns="columns" :data="[...record.lines]" :min-rows="5" empty="暂无材料明细" />
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="store.loading || !loaded" class="py-12 text-center text-ink-faint">
    加载中...
  </div>
  <div v-else class="rounded-[var(--radius-card)] border border-line bg-panel p-6 text-13px text-ink-soft">
    未找到该送货单（可能已被删除）。
    <NuxtLink to="/material/delivery/archive" class="cell--link ml-2">
      返回送货单归档库
    </NuxtLink>
  </div>
</template>

<style scoped>
.delivery-record-detail {
  container-type: inline-size;
}

.delivery-record-layout {
  grid-template-columns: minmax(0, 1fr);
}

.delivery-record-info {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
}

.delivery-record-info__full {
  grid-column: 1 / -1;
}

@container (min-width: 64rem) {
  .delivery-record-layout {
    grid-template-columns: minmax(22.5rem, 42%) minmax(0, 1fr);
  }

  .delivery-record-source {
    position: sticky;
    top: var(--space-4, 16px);
  }
}

.detail-row {
  display: flex;
  min-width: 0;
  gap: 10px;
  border-bottom: 1px dashed var(--line);
  padding: 9px 0;
  font-size: 13px;
}
.detail-label {
  width: 88px;
  flex: none;
  color: var(--ink-soft);
}
</style>
