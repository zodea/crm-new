<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import { computed, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import DeliveryRecordSourcePanel from '~/components/delivery/DeliveryRecordSourcePanel.vue'
import { yuan } from '~/lib/util/money'
import DeliveryRecordHistory from '~/pages/material/delivery/archive/_components/DeliveryRecordHistory.vue'
import DeliveryRecordSummary from '~/pages/material/delivery/archive/_components/DeliveryRecordSummary.vue'

const route = useRoute()
const store = useDeliveryRecordStore()
const { confirm, undoToast, error } = useKitUI()

const recordId = computed(() => String(route.params.id))
const loaded = shallowRef(false)
const loadError = shallowRef('')
const deleting = shallowRef(false)
const requestedOrigin = computed(() => route.query?.origin ?? 'real')
const record = computed(() => loaded.value && !loadError.value ? store.byId(recordId.value) : undefined)
const projectName = computed(() => (record.value?.projectName))
const supplierName = computed(() => (record.value?.supplierName))
const canWrite = computed(() => !!record.value && (store.canWrite))
let active = true
let request = 0
function path(value: string) {
  return (`${value}?origin=${store.origin}`)
}

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
  const current = record.value
  if (!current || !canWrite.value || deleting.value)
    return
  const generation = request
  const label = current.orderNo || current.id
  deleting.value = true
  try {
    const ok = await confirm({
      variant: 'simple',
      title: '删除送货单',
      message: `确认删除送货单「${label}」？材料明细会随送货单一同隐藏，10 秒内可撤回。`,
      confirmLabel: '删除',
    })
    if (!ok || !active || generation !== request || !canWrite.value)
      return
    const logId = await store.remove(current.id)
    if (!active || generation !== request)
      return
    if (!logId) {
      error('删除失败：送货单不存在或已删除')
      return
    }
    undoToast(`已删除送货单「${label}」`, () => store.undo(logId))
    await navigateTo(path('/material/delivery/archive'))
  }
  catch (cause) {
    if (active && generation === request)
      error(cause instanceof Error ? cause.message : '删除送货单失败')
  }
  finally {
    deleting.value = false
  }
}

async function refresh() {
  const generation = ++request
  loaded.value = false
  loadError.value = ''
  try {
    if (requestedOrigin.value !== store.origin)
      throw new Error('链接来源与当前数据模式不同，请切换到对应来源后重新读取')
    await store.load()
    if (!active || generation !== request)
      return
    const current = store.byId(recordId.value)
    if (current && current.dataOrigin !== requestedOrigin.value)
      throw new Error('当前记录来源不匹配，请重新读取')
  }
  catch (cause) {
    if (active && generation === request)
      loadError.value = cause instanceof Error ? cause.message : '送货记录读取失败'
  }
  finally {
    if (active && generation === request)
      loaded.value = true
  }
}

function suspend() {
  active = false
  request++
  loaded.value = false
}
watch([recordId, requestedOrigin, () => store.origin], () => {
  if (active)
    void refresh()
}, { immediate: true })
onActivated(() => {
  if (!active) {
    active = true
    void refresh()
  }
})
onDeactivated(suspend)
onBeforeUnmount(suspend)
</script>

<template>
  <div v-if="record" class="delivery-record-detail flex min-w-0 flex-col gap-4">
    <div class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <NuxtLink :to="path('/material/delivery/archive')" class="icon-btn" title="返回归档库">
        <span class="i-lucide-arrow-left text-14px" />
      </NuxtLink>
      <div class="min-w-0 flex-1">
        <div class="text-17px font-800 text-ink">
          {{ record.orderNo || '未编号送货单' }}
        </div>
        <div class="mt-0.5 text-12px text-ink-faint">
          {{ projectName || '项目名称待核验' }} · {{ supplierName || '分供方待核验' }}
        </div>
      </div>
      <div v-if="canWrite" class="ml-auto flex flex-wrap items-center gap-2">
        <NuxtLink :to="path(`/material/delivery/archive/form/${encodeURIComponent(record.id)}`)" class="btn-secondary">
          <span class="i-lucide-square-pen mr-1 text-13px" /> 编辑
        </NuxtLink>
        <KitButton variant="danger" :loading="deleting" @click="handleDelete">
          <span class="i-lucide-trash-2 mr-1 text-13px" /> 删除
        </KitButton>
      </div>
    </div>

    <DeliveryRecordSummary
      :delivery-date="record.deliveryDate"
      :line-count="record.lines.length"
      :total-amount="record.totalAmount"
      :print-disposition="record.printDisposition"
    />

    <div class="delivery-record-layout grid min-w-0 items-start gap-4">
      <DeliveryRecordSourcePanel
        :record-id="record.id"
        :read-only="!canWrite"
        min-height="clamp(22rem, 60dvh, 42.5rem)"
        class="delivery-record-source self-start"
      />

      <div class="flex min-w-0 flex-col gap-4">
        <div class="panel px-4 py-3">
          <SectionHeader title="单据信息" subtitle="右侧结构化数据应与左侧原件逐项核对" />
          <div class="delivery-record-info mt-2 grid gap-x-8">
            <div class="detail-row">
              <span class="detail-label">所属项目</span><NuxtLink :to="path(`/project/${encodeURIComponent(record.projectId)}`)" class="cell--link">
                {{ projectName || '项目名称待核验' }}
              </NuxtLink>
            </div>
            <div class="detail-row">
              <span class="detail-label">分供方</span><NuxtLink v-if="record.supplierId" :to="path(`/base/supplier/${encodeURIComponent(record.supplierId)}`)" class="cell--link">
                {{ supplierName || '分供方名称待核验' }}
              </NuxtLink><span v-else class="text-warn-ink">分供方待核验</span>
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
    <DeliveryRecordHistory :record-id="record.id" :current-version="record.version" />
  </div>

  <div v-else-if="loadError" role="alert" class="panel p-6 text-13px text-danger">
    <p>{{ loadError }}</p>
    <KitButton class="mt-3" @click="refresh">
      重新读取
    </KitButton>
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
