<script setup lang="ts">
import type { DeliveryRevision } from '~/lib/delivery-record/contract'
import type { KitTableColumn } from '~/lib/kit/table'
import { computed, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{ recordId: string, currentVersion?: string }>()
const store = useDeliveryRecordStore()
const opened = shallowRef(false)
const loading = shallowRef(false)
const loadError = shallowRef('')
const revisions = shallowRef<DeliveryRevision[]>([])
const selectedId = shallowRef('')
const side = shallowRef<'before' | 'after'>('after')
const selected = computed(() => revisions.value.find(revision => revision.id === selectedId.value))
const snapshot = computed(() => selected.value?.[side.value])
let controller: AbortController | null = null
let active = true
const actionLabels: Record<DeliveryRevision['action'], string> = { archive: '归档', revise: '字段与明细修订', source: '原件修订', print: '打印处置', delete: '删除', restore: '恢复', undo: '撤回', migration: '旧库迁入' }
const printLabels = { pending: '待打印', printed: '已确认打印', excluded: '已排除打印' }
const columns: KitTableColumn[] = [
  { title: '#', type: 'seq' },
  { field: 'materialName', title: '材料名称', minWidth: 180 },
  { field: 'spec', title: '规格型号', minWidth: 140 },
  { field: 'unit', title: '单位', width: 80 },
  { field: 'qty', title: '数量', width: 100, align: 'right' },
  { field: 'unitPrice', title: '单价', type: 'money', width: 120 },
  { field: 'amount', title: '金额', type: 'money', width: 130 },
  { field: 'note', title: '备注', minWidth: 150 },
]
const fields = computed(() => {
  const record = snapshot.value
  return record
    ? [
        ['所属项目', record.projectName],
        ['分供方', record.supplierName || '待核验'],
        ['送货单号', record.orderNo || '原件无单号'],
        ['送货日期', record.deliveryDate || '待核验'],
        ['金额合计', yuan(record.totalAmount)],
        ['打印处置', printLabels[record.printDisposition]],
        ['核对状态', record.currentValuesConfirmed ? '已人工核对' : '待人工核对'],
        ['核对标记', record.reviewFlag || '—'],
        ['备注', record.note || '—'],
        ['OCR 工地原文', record.rawSiteText || '未记录'],
        ['归档状态', record.archived ? '已归档' : '尚未归档'],
        ['记录状态', record.deletedAt ? '已删除' : '保留'],
        ['打印确认时间', record.printedAt || '未记录'],
        ['打印排除时间', record.printExcludedAt || '未记录'],
      ]
    : []
})

async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  opened.value = true
  loading.value = true
  loadError.value = ''
  revisions.value = []
  selectedId.value = ''
  side.value = 'after'
  try {
    const result = await store.history(props.recordId, { signal: current.signal })
    if (!active || current.signal.aborted)
      return
    revisions.value = [...result].reverse()
    selectedId.value = revisions.value[0]?.id ?? ''
  }
  catch (cause) {
    if (active && !current.signal.aborted)
      loadError.value = cause instanceof Error ? cause.message : '送货历史读取失败'
  }
  finally {
    if (!current.signal.aborted)
      loading.value = false
  }
}
function selectRevision(id: string) {
  selectedId.value = id
  side.value = 'after'
}
function clear() {
  controller?.abort()
  revisions.value = []
  selectedId.value = ''
  loadError.value = ''
  loading.value = false
}
function suspend() {
  active = false
  clear()
}
watch([() => props.recordId, () => store.origin], () => {
  clear()
  opened.value = false
})
watch(() => store.sourceVersion, () => {
  if (active && opened.value)
    void load()
})
onActivated(() => {
  if (!active) {
    active = true
    if (opened.value)
      void load()
  }
})
onDeactivated(suspend)
onBeforeUnmount(suspend)
</script>

<template>
  <section class="panel min-w-0 p-4" aria-label="送货修订历史">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-15px font-700 text-ink">
          修订历史
        </h2>
        <p class="mt-1 text-12px text-ink-soft">
          历史版本只读，原件按当时已留存的关联展示。
        </p>
      </div>
      <KitButton :loading="loading" @click="load">
        {{ opened ? '重新读取历史' : '查看修订历史' }}
      </KitButton>
    </div>
    <p v-if="loading" role="status" class="py-4 text-13px text-ink-soft">
      正在核验历史记录…
    </p>
    <p v-else-if="loadError" role="alert" class="mt-3 text-13px text-danger">
      {{ loadError }}
    </p>
    <p v-else-if="opened && !revisions.length" class="mt-3 text-13px text-ink-soft">
      暂无已留存修订。
    </p>
    <div v-else-if="selected && snapshot" class="mt-4 flex min-w-0 flex-col gap-4">
      <div class="flex flex-wrap gap-2" aria-label="选择修订版本">
        <KitButton v-for="revision in revisions" :key="revision.id" :variant="selectedId === revision.id ? 'primary' : 'secondary'" :aria-pressed="selectedId === revision.id" @click="selectRevision(revision.id)">
          版本 {{ revision.version }} · {{ actionLabels[revision.action] }}{{ revision.version === currentVersion ? '（当前）' : '' }}
        </KitButton>
      </div>
      <dl class="grid gap-2 text-13px text-ink-soft sm:grid-cols-3">
        <div>
          <dt>修订原因</dt><dd class="mt-1 whitespace-pre-wrap break-words text-ink">
            {{ selected.reason || '旧记录未留存原因' }}
          </dd>
        </div>
        <div>
          <dt>操作者</dt><dd class="mt-1 text-ink">
            {{ selected.actorId || '旧记录未留存操作者' }}
          </dd>
        </div>
        <div>
          <dt>修订时间</dt><dd class="mt-1 break-words text-ink">
            {{ selected.createdAt || '旧记录未留存时间' }}
          </dd>
        </div>
      </dl>
      <div class="flex flex-wrap gap-2">
        <KitButton v-if="selected.before" :aria-pressed="side === 'before'" :variant="side === 'before' ? 'primary' : 'secondary'" @click="side = 'before'">
          修改前
        </KitButton>
        <KitButton :aria-pressed="side === 'after'" :variant="side === 'after' ? 'primary' : 'secondary'" @click="side = 'after'">
          修改后
        </KitButton>
      </div>
      <dl class="grid min-w-0 gap-x-6 text-13px sm:grid-cols-2">
        <div v-for="field in fields" :key="field[0]" class="flex min-w-0 gap-3 border-b border-line py-2">
          <dt class="w-24 shrink-0 text-ink-soft">
            {{ field[0] }}
          </dt><dd class="min-w-0 whitespace-pre-wrap break-words text-ink">
            {{ field[1] }}
          </dd>
        </div>
      </dl>
      <KitTable :columns="columns" :data="snapshot.lines" :min-rows="3" empty="此版本未留存材料明细" />
      <p v-if="snapshot.legacyAudit" class="text-12px text-warn-ink">
        {{ snapshot.legacyAudit }}
      </p>
      <DeliveryRecordSourcePanel :record-id="recordId" :asset-id="snapshot.assetId" read-only min-height="24rem" />
    </div>
  </section>
</template>
