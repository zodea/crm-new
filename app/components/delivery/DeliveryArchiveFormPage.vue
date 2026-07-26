<script setup lang="ts">
import type { DeliveryAmountSource } from '~/lib/delivery/review'
import type { FormFooterAction } from '~/lib/master-data/page'
import type { DeliveryLineDraft, DeliveryRecordInput } from '~/stores/delivery-record'
import { onBeforeRouteLeave } from 'vue-router'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

interface EditableDeliveryLine extends Omit<DeliveryLineDraft, 'amount' | 'amountSource'> {
  key: string
  amount: number | null
  amountSource: DeliveryAmountSource
}

const route = useRoute()
const store = useDeliveryRecordStore()
const materialStore = useMaterialStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const recordId = computed(() => String(route.params.id))
const record = computed(() => store.byId(recordId.value))
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)
const title = computed(() => `编辑 · 送货单归档${record.value?.orderNo ? ` ${record.value.orderNo}` : ''}`)
useTabTitle(title)

const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
const draft = ref<{
  projectId: string | null
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  note: string
  lines: EditableDeliveryLine[]
}>({
  projectId: null,
  supplierId: null,
  orderNo: '',
  deliveryDate: '',
  note: '',
  lines: [],
})
let allowLeave = false

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value)

const fetchProjects = materialStore.searchProjects
const fetchSuppliers = materialStore.searchSuppliers

async function initialize() {
  loading.value = true
  try {
    await store.load()
    const current = record.value
    if (!current) {
      error('送货单不存在或已删除')
      allowLeave = true
      await navigateTo('/material/delivery/archive')
      return
    }
    draft.value = {
      projectId: current.projectId,
      supplierId: current.supplierId,
      orderNo: current.orderNo,
      deliveryDate: current.deliveryDate,
      note: current.note,
      lines: current.lines.map(line => ({
        key: line.id,
        materialName: line.materialName,
        spec: line.spec,
        unit: line.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
        amount: line.amount,
        amountSource: line.amountSource,
        note: line.note,
      })),
    }
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
  }
  catch (cause) {
    error(`载入失败：${toErrorMessage(cause)}`)
  }
  finally {
    loading.value = false
  }
}

function patch(patchValue: Partial<typeof draft.value>) {
  draft.value = { ...draft.value, ...patchValue }
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

async function save() {
  if (!draft.value.projectId) {
    warning('送货单必须选择项目')
    return
  }
  const lines = draft.value.lines.filter(line => line.materialName.trim())
  if (!lines.length) {
    warning('至少填写一条材料明细')
    return
  }
  const current = record.value
  if (!current)
    return
  const accepted = await confirm({
    variant: 'simple',
    title: '修改已归档送货单',
    message: `送货单「${current.orderNo || current.id}」已归档。确认修改归属、单据字段和材料明细？OCR 原文与原件留痕不会被覆盖。`,
    confirmLabel: '确认修改',
  })
  if (!accepted)
    return

  loadingAction.value = 'save'
  try {
    const input: DeliveryRecordInput = {
      projectId: draft.value.projectId,
      supplierId: draft.value.supplierId,
      orderNo: draft.value.orderNo,
      deliveryDate: draft.value.deliveryDate,
      note: draft.value.note,
      lines: lines.map(({ key: _key, ...line }): DeliveryLineDraft => line),
    }
    const logId = await store.update(current.id, input)
    if (!logId) {
      error('保存失败：送货单不存在或已删除')
      return
    }
    success('送货单归档已更新')
    allowLeave = true
    if (closeAfterSave.value) {
      tabsStore.close(pageKey)
      await navigateTo(`/material/delivery/archive/${current.id}`)
      return
    }
    await initialize()
    allowLeave = false
  }
  catch (cause) {
    error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveToDetail()
    return
  }
  await save()
}

async function leaveToDetail() {
  if (dirty.value) {
    const leave = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前送货单还有未保存内容，确认放弃？',
      confirmLabel: '放弃修改',
    })
    if (!leave)
      return
  }
  allowLeave = true
  tabsStore.close(pageKey)
  await navigateTo(`/material/delivery/archive/${recordId.value}`)
}

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true
  if (tabsStore.tabs.some(tab => tab.key === pageKey))
    return true
  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前送货单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  if (!leave)
    tabsStore.open({ fullPath: pageFullPath, title: title.value })
  return leave
})

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div v-if="record" class="mx-auto flex w-full max-w-1440px flex-col gap-4 pb-6">
    <header class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <button type="button" class="icon-btn" title="返回送货单详情" @click="leaveToDetail">
        <span class="i-lucide-arrow-left text-14px" aria-hidden="true" />
      </button>
      <div class="min-w-0 flex-1">
        <h1 class="text-18px font-800 text-ink">
          {{ title }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          归档不是终态：归属与结构化字段可修正；原件和 OCR 原文只留痕，不随修改覆盖。
        </p>
      </div>
      <span class="chip-ok">已归档</span>
    </header>

    <div v-if="loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
      正在载入送货单…
    </div>

    <form v-else class="flex flex-col gap-4" @submit.prevent>
      <div class="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(22.5rem,40%)_minmax(0,1fr)]">
        <DeliveryRecordSourcePanel
          :record-id="record.id"
          min-height="clamp(28rem, 68dvh, 50rem)"
          class="self-start xl:sticky xl:top-4"
        />

        <div class="flex min-w-0 flex-col gap-4">
          <section class="panel p-4">
            <SectionHeader title="档案留痕" subtitle="以下原文不随结构化归属修改" />
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <div class="info-cell rounded-[var(--radius-control)] border border-line">
                <span class="block text-11px text-ink-faint">原件文件名</span>
                <strong class="mt-1 block break-all text-13px text-ink">{{ record.fileName || '—' }}</strong>
              </div>
              <div class="info-cell rounded-[var(--radius-control)] border border-line">
                <span class="block text-11px text-ink-faint">OCR / 工地原文</span>
                <strong class="mt-1 block break-all text-13px text-ink">{{ record.rawSiteText || '—' }}</strong>
              </div>
            </div>
          </section>

          <section class="panel p-4">
            <SectionHeader title="归属与单据字段" />
            <div class="form-fields-grid mt-3">
              <div class="field-block">
                <span class="field-label">所属项目 *</span>
                <LookupSelect
                  :model-value="draft.projectId"
                  :fetch="fetchProjects"
                  recent-key="delivery-archive-project"
                  placeholder="检索项目"
                  @update:model-value="patch({ projectId: $event })"
                />
              </div>
              <div class="field-block">
                <span class="field-label">分供方</span>
                <LookupSelect
                  :model-value="draft.supplierId"
                  :fetch="fetchSuppliers"
                  recent-key="delivery-archive-supplier"
                  placeholder="检索分供方；可留空"
                  @update:model-value="patch({ supplierId: $event })"
                />
              </div>
              <label class="field-block">
                <span class="field-label">送货单号</span>
                <input :value="draft.orderNo" class="field-input w-full font-mono" @input="patch({ orderNo: inputValue($event) })">
              </label>
              <label class="field-block">
                <span class="field-label">送货日期</span>
                <input :value="draft.deliveryDate" type="date" class="field-input w-full font-mono" @input="patch({ deliveryDate: inputValue($event) })">
              </label>
              <label class="field-block form-span-full">
                <span class="field-label">备注</span>
                <textarea :value="draft.note" rows="3" class="field-input w-full" @input="patch({ note: inputValue($event) })" />
              </label>
            </div>
          </section>
        </div>
      </div>

      <DeliveryArchiveLineGrid :lines="draft.lines" @update="patch({ lines: $event })" />

      <FormFooter
        v-model="closeAfterSave"
        :actions="['cancel', 'save']"
        :labels="{ save: '保存归档修改' }"
        :dirty="dirty"
        close-after-save
        :loading-action="loadingAction"
        @action="handleFooterAction"
      />
    </form>
  </div>
</template>
