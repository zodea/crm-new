<script setup lang="ts">
import type { DeliveryAmountSource } from '~/lib/delivery/review'
import type { FormFooterAction } from '~/lib/master-data/page'
import type { DeliveryLineDraft, DeliveryRecordInput } from '~/stores/delivery-record'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue'
import DeliveryArchiveLineGrid from '~/components/delivery/DeliveryArchiveLineGrid.vue'
import DeliveryConflictReview from '~/components/delivery/DeliveryConflictReview.vue'
import DeliveryRecordSourcePanel from '~/components/delivery/DeliveryRecordSourcePanel.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { hasDeliveryPricePending, normalizeDeliveryOrderNo, summarizeDeliveryAmounts } from '~/lib/delivery/review'
import { ProjectRepositoryProblem } from '~/lib/project/repository'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { isISODateDTO } from '~/types/read-model'

interface EditableDeliveryLine extends Omit<DeliveryLineDraft, 'amount' | 'amountSource'> {
  key: string
  amount: number | null
  amountSource: DeliveryAmountSource
}

interface DeliveryArchiveDraft {
  projectId: string | null
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  note: string
  lines: EditableDeliveryLine[]
}

const route = useRoute()
const ownPageKey = deriveKey(route.fullPath)
const ownsPage = () => deriveKey(route.fullPath) === ownPageKey
const store = useDeliveryRecordStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const recordId = computed(() => {
  const value = route.params.id
  return typeof value === 'string' ? value.trim() : ''
})
const isCreate = computed(() => !recordId.value)
const record = computed(() => recordId.value ? store.byId(recordId.value) : undefined)
const pageFullPath = computed(() => route.fullPath)
const pageKey = computed(() => deriveKey(pageFullPath.value))
const title = computed(() => isCreate.value
  ? '新建 · 送货单归档'
  : `编辑 · 送货单归档${record.value?.orderNo ? ` ${record.value.orderNo}` : ''}`)
useTabTitle(title)

const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
const loadError = shallowRef('')
const revisionReason = shallowRef('')
const baseVersion = shallowRef<string>()
const versionConflict = shallowRef(false)
const reviewedRecord = shallowRef<NonNullable<ReturnType<typeof store.byId>>>()
const draft = ref<DeliveryArchiveDraft>(emptyDraft())
let allowLeave = false
let initialization = 0
let active = true
let loadedIdentity = ''

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value || !!revisionReason.value)

const writable = computed(() => store.canWrite)
async function fetchReferences(kind: 'projects' | 'suppliers', keyword: string) {
  const query = keyword.trim().toLocaleLowerCase('zh-CN')
  return (store.context?.[kind] ?? [])
    .filter(row => row.name.toLocaleLowerCase('zh-CN').includes(query))
    .map(row => ({ id: row.id, label: row.name }))
}
const fetchProjects = (keyword: string) => fetchReferences('projects', keyword)
const fetchSuppliers = (keyword: string) => fetchReferences('suppliers', keyword)

function emptyLine(): EditableDeliveryLine {
  return {
    key: `delivery-line-new-${Date.now()}`,
    materialName: '',
    spec: '',
    unit: '',
    qty: null,
    unitPrice: null,
    amount: 0,
    amountSource: 'calculated',
    note: '',
  }
}

function emptyDraft(): DeliveryArchiveDraft {
  return {
    projectId: null,
    supplierId: null,
    orderNo: '',
    deliveryDate: '',
    note: '',
    lines: [emptyLine()],
  }
}

async function initialize(resetDraft = false) {
  if (!ownsPage())
    return
  const request = ++initialization
  const requestedId = recordId.value
  const origin = store.origin
  const identity = JSON.stringify([requestedId, origin])
  const preserveDraft = !resetDraft && loadedIdentity === identity && dirty.value
  reviewedRecord.value = undefined
  if (!preserveDraft)
    versionConflict.value = false
  loading.value = true
  loadError.value = ''
  try {
    if (route.query?.origin && route.query.origin !== origin)
      throw new Error('页面来源与当前来源不一致，请返回当前来源的归档库')
    await store.load()
    if (!active || !ownsPage() || request !== initialization || requestedId !== recordId.value || origin !== store.origin)
      return
    if (!requestedId) {
      if (preserveDraft)
        return
      revisionReason.value = ''
      baseVersion.value = undefined
      draft.value = emptyDraft()
      await nextTick()
      if (!active || request !== initialization)
        return
      savedSnapshot.value = JSON.stringify(draft.value)
      loadedIdentity = identity
      return
    }

    const current = record.value
    if (!current) {
      loadError.value = '送货单不存在或已删除'
      return
    }
    if (preserveDraft)
      return
    revisionReason.value = ''
    baseVersion.value = current.version
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
    if (!active || request !== initialization)
      return
    savedSnapshot.value = JSON.stringify(draft.value)
    loadedIdentity = identity
  }
  catch (cause) {
    if (request === initialization)
      loadError.value = `载入失败：${toErrorMessage(cause)}`
  }
  finally {
    if (request === initialization)
      loading.value = false
  }
}

function patch(patchValue: Partial<DeliveryArchiveDraft>) {
  draft.value = { ...draft.value, ...patchValue }
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

async function reviewCurrentRecord() {
  if (!active || !ownsPage() || loading.value || loadingAction.value || !versionConflict.value)
    return
  const requestedId = recordId.value
  const origin = store.origin
  const pending = initialize()
  const request = initialization
  await pending
  if (!active || !ownsPage() || request !== initialization || requestedId !== recordId.value || origin !== store.origin || loadError.value || !writable.value)
    return
  const current = record.value
  if (current?.version)
    reviewedRecord.value = { ...current, lines: current.lines.map(line => ({ ...line })) }
}

async function adoptReviewedVersion() {
  const reviewed = reviewedRecord.value
  if (!reviewed?.version || !active || !ownsPage() || !writable.value || loading.value || loadingAction.value)
    return
  const request = initialization
  const origin = store.origin
  loadingAction.value = 'save'
  try {
    const accepted = await confirm({
      variant: 'simple',
      title: '采用已核对的当前版本',
      message: '下方人工稿保持不变。请逐项对照当前记录调整需要保留的内容；采用后再次保存，会以人工稿修订这份当前记录。',
      confirmLabel: '已核对，保留人工稿',
      cancelLabel: '继续核对',
    })
    if (!accepted || !active || !ownsPage() || request !== initialization || origin !== store.origin || !writable.value || reviewedRecord.value !== reviewed)
      return
    if (record.value?.id !== reviewed.id || record.value.version !== reviewed.version) {
      reviewedRecord.value = undefined
      warning('记录再次更新，请重新核对当前记录')
      return
    }
    baseVersion.value = reviewed.version
    reviewedRecord.value = undefined
    versionConflict.value = false
  }
  finally {
    loadingAction.value = null
  }
}

async function save() {
  if (!active || loading.value || loadingAction.value || loadError.value)
    return
  if (!writable.value) {
    warning('当前来源或权限不允许保存送货单')
    return
  }
  if (!draft.value.projectId) {
    warning('送货单必须选择项目')
    return
  }
  if (!draft.value.supplierId) {
    warning('请依据原件人工选择分供方')
    return
  }
  if (!isISODateDTO(draft.value.deliveryDate)) {
    warning('请依据原件人工填写送货日期')
    return
  }
  if (!isCreate.value && !revisionReason.value.trim()) {
    warning('请填写本次修订原因')
    return
  }
  const lines = draft.value.lines
  if (!lines.length) {
    warning('至少填写一条材料明细')
    return
  }
  if (lines.some(line => !line.materialName.trim() || !line.unit.trim() || line.qty == null || !Number.isFinite(line.qty) || line.qty <= 0)) {
    warning('每条明细必须确认材料名称、单位和非零数量，请修正或删除未完成行')
    return
  }
  if (lines.some(line => [line.unitPrice, line.amount].some(value => value != null && (!Number.isFinite(value) || value < 0)))) {
    warning('单价或金额存在异常数值，请先修正')
    return
  }
  const request = initialization
  const origin = store.origin
  const savedPageKey = pageKey.value
  const applicable = () => active && request === initialization && origin === store.origin && writable.value
  const current = record.value
  const confirmations = {
    noOrderNoConfirmed: false,
    pricePendingConfirmed: false,
    amountReviewed: false,
  }
  loadingAction.value = 'save'
  try {
    if (summarizeDeliveryAmounts(lines.map(line => ({ ...line, id: line.key })), null).mismatchedLineIds.length) {
      if (!draft.value.note.trim()) {
        warning('金额复核必须在备注填写保留票面金额或修正金额的原因')
        return
      }
      confirmations.amountReviewed = await confirm({ variant: 'simple', title: '确认金额复核结果', message: '部分行的数量 × 单价与金额不一致，请对照原件确认当前金额及备注中的原因。', confirmLabel: '确认已复核' })
      if (!confirmations.amountReviewed || !applicable())
        return
    }
    if (!normalizeDeliveryOrderNo(draft.value.orderNo)) {
      confirmations.noOrderNoConfirmed = await confirm({
        variant: 'simple',
        title: '确认原件确实无单号',
        message: '当前送货单号为空。请再次对照原件，只有原件确实没有单号时才可按无单号归档。',
        confirmLabel: '确认无单号',
      })
      if (!confirmations.noOrderNoConfirmed || !applicable())
        return
    }
    if (hasDeliveryPricePending(lines)) {
      confirmations.pricePendingConfirmed = await confirm({
        variant: 'simple',
        title: '确认按价格待补录归档',
        message: '当前至少一条明细缺少单价或金额。确认后仍可归档，但会标记为“价格待补录”，且在补齐前不进入材料价格分析。',
        confirmLabel: '确认待补录',
      })
      if (!confirmations.pricePendingConfirmed || !applicable())
        return
    }
    if (!isCreate.value) {
      if (!current)
        return
      const accepted = await confirm({
        variant: 'simple',
        title: '修改已归档送货单',
        message: `送货单「${current.orderNo || current.id}」已归档。确认修改归属、单据字段和材料明细？OCR 原文与原件留痕不会被覆盖。`,
        confirmLabel: '确认修改',
      })
      if (!accepted || !applicable())
        return
    }

    if (!applicable())
      return
    const input: DeliveryRecordInput = {
      projectId: draft.value.projectId,
      supplierId: draft.value.supplierId,
      orderNo: draft.value.orderNo,
      deliveryDate: draft.value.deliveryDate,
      note: draft.value.note,
      confirmations,
      lines: lines.map(({ key, id: _id, ...line }): DeliveryLineDraft => ({ ...line, ...(current?.lines.some(item => item.id === key) ? { id: key } : {}) })),
    }
    let savedId: string
    if (current) {
      const logId = await store.update(current.id, input, revisionReason.value.trim(), baseVersion.value)
      if (!applicable())
        return
      if (!logId) {
        error('保存失败：送货单不存在或已删除')
        return
      }
      savedId = current.id
      success('送货单归档已更新')
    }
    else {
      savedId = await store.add(input)
      if (!applicable())
        return
      success('送货单归档已新增')
    }

    allowLeave = true
    tabsStore.close(savedPageKey)
    if (closeAfterSave.value) {
      await navigateTo(withOrigin(`/material/delivery/archive/${encodeURIComponent(savedId)}`))
      return
    }
    if (isCreate.value) {
      await navigateTo(withOrigin(`/material/delivery/archive/form/${encodeURIComponent(savedId)}`))
      return
    }
    await initialize(true)
  }
  catch (cause) {
    if (applicable() && cause instanceof ProjectRepositoryProblem && cause.problem.code === 'conflict') {
      versionConflict.value = true
      reviewedRecord.value = undefined
    }
    if (applicable())
      error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
    allowLeave = false
  }
}

function withOrigin(path: string): string {
  return (`${path}?origin=${store.origin}`)
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveToDetail()
    return
  }
  await save()
}

async function leaveToDetail() {
  const request = initialization
  if (dirty.value) {
    const leave = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前送货单还有未保存内容，确认放弃？',
      confirmLabel: '放弃修改',
    })
    if (!leave || !active || request !== initialization)
      return
  }
  allowLeave = true
  tabsStore.close(pageKey.value)
  await navigateTo(withOrigin(isCreate.value
    ? '/material/delivery/archive'
    : `/material/delivery/archive/${encodeURIComponent(recordId.value)}`))
}

useTabCloseGuard(async () => {
  if (allowLeave || !dirty.value)
    return true
  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前送货单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  return leave
})

watch(() => [recordId.value, route.query?.origin, store.origin], () => {
  if (!ownsPage())
    return
  allowLeave = false
  if (active)
    void initialize()
}, { immediate: true, flush: 'sync' })
onDeactivated(() => {
  active = false
  initialization += 1
  reviewedRecord.value = undefined
})
onActivated(() => {
  if (active)
    return
  active = true
  void initialize()
})
onBeforeUnmount(() => {
  active = false
  initialization += 1
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-1440px flex-col gap-4 pb-6">
    <header class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <KitButton
        type="button"
        class="icon-btn"
        :title="isCreate ? '返回送货单归档库' : '返回送货单详情'"
        @click="leaveToDetail"
      >
        <span class="i-lucide-arrow-left text-14px" aria-hidden="true" />
      </KitButton>
      <div class="min-w-0 flex-1">
        <h1 class="text-18px font-800 text-ink">
          {{ title }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          {{ isCreate
            ? '手工补录送货单归档；保存后即进入材料台账。'
            : '归档不是终态：归属与结构化字段可修正；原件和 OCR 原文只留痕，不随修改覆盖。' }}
        </p>
      </div>
      <span :class="isCreate ? 'chip-brand' : 'chip-ok'">
        {{ isCreate ? '手工新增' : '已归档' }}
      </span>
    </header>

    <div v-if="loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
      正在载入送货单…
    </div>

    <div v-else-if="loadError" role="alert" class="panel p-5 text-13px text-danger">
      {{ loadError }}
      <KitButton variant="secondary" class="ml-2" @click="initialize()">
        重新读取
      </KitButton>
    </div>

    <form v-else-if="isCreate || record" class="flex flex-col gap-4" @submit.prevent>
      <div v-if="versionConflict" role="alert" class="panel flex flex-wrap items-center gap-3 p-4 text-13px text-warn-ink">
        <p class="min-w-0 flex-1">
          记录已被更新。人工稿与修订原因已保留，请先核对当前记录，再决定如何保存。
        </p>
        <KitButton :disabled="!!loadingAction || !writable" @click="reviewCurrentRecord">
          重新核对当前记录
        </KitButton>
      </div>
      <DeliveryConflictReview
        v-if="reviewedRecord"
        :record="reviewedRecord"
        :busy="!!loadingAction || !writable"
        @accept="adoptReviewedVersion"
        @cancel="reviewedRecord = undefined"
      />
      <div v-if="!writable" role="alert" class="panel p-3 text-warn-ink">
        当前来源或权限只允许查看，不能保存修改。
      </div>
      <fieldset :disabled="!writable || !!loadingAction" class="contents">
        <div
          class="grid min-w-0 items-start gap-4"
          :class="record
            ? 'xl:grid-cols-[minmax(22.5rem,40%)_minmax(0,1fr)]'
            : 'mx-auto w-full max-w-1080px'"
        >
          <DeliveryRecordSourcePanel
            v-if="record"
            :record-id="record.id"
            read-only
            min-height="clamp(28rem, 68dvh, 50rem)"
            class="self-start xl:sticky xl:top-4"
          />

          <div class="flex min-w-0 flex-col gap-4">
            <section v-if="record" class="panel p-4">
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
                  <span class="field-label">分供方 *</span>
                  <LookupSelect
                    :model-value="draft.supplierId"
                    :fetch="fetchSuppliers"
                    recent-key="delivery-archive-supplier"
                    placeholder="依据原件选择分供方"
                    @update:model-value="patch({ supplierId: $event })"
                  />
                </div>
                <label class="field-block">
                  <span class="field-label">送货单号</span>
                  <input :value="draft.orderNo" class="field-input w-full font-mono" @input="patch({ orderNo: inputValue($event) })">
                </label>
                <label class="field-block">
                  <span class="field-label">送货日期 *</span>
                  <input :value="draft.deliveryDate" type="date" class="field-input w-full font-mono" @input="patch({ deliveryDate: inputValue($event) })">
                </label>
                <label v-if="!isCreate" class="field-block form-span-full">
                  <span class="field-label">修订原因 *</span>
                  <textarea v-model="revisionReason" rows="2" class="field-input w-full" />
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
      </fieldset>

      <FormFooter
        v-model="closeAfterSave"
        :actions="writable ? ['cancel', 'save'] : ['cancel']"
        :labels="{ save: isCreate ? '保存送货单' : '保存归档修改' }"
        :dirty="dirty"
        close-after-save
        :loading-action="loadingAction"
        @action="handleFooterAction"
      />
    </form>

    <div v-else class="panel px-5 py-10 text-center text-13px text-ink-soft">
      未找到该送货单（可能已被删除）。
      <NuxtLink :to="withOrigin('/material/delivery/archive')" class="cell--link ml-2">
        返回送货单归档库
      </NuxtLink>
    </div>
  </div>
</template>
