<script setup lang="ts">
import type {
  CreateBoqChangeOrderDraft,
  ReviseApprovedBoqChangeOrderDraft,
} from '~/lib/boq/change'
import type { BoqAttachmentView, BoqChangeOrderView, BoqWorkspace } from '~/lib/boq/read-model'
import type { FieldDef } from '~/lib/kit/form-modal'
import type { KitTableColumn } from '~/lib/kit/table'
import type { BoqAttachmentDraft } from '~/stores/boq'
import { useFileDialog } from '@vueuse/core'
import {
  BOQ_CHANGE_STATUS_LABEL,
  BOQ_CHANGE_TYPE_LABEL,
} from '~/lib/boq/presentation'
import { toLocalDateInputValue } from '~/lib/util/local-date'

const props = defineProps<{
  workspace: BoqWorkspace
  busy?: boolean
}>()

const emit = defineEmits<{
  create: [draft: CreateBoqChangeOrderDraft]
  transition: [payload: { orderId: string, target: 'submitted' | 'rejected', note: string }]
  approve: [payload: { orderId: string, approvedAt: string }]
  reviseApproved: [payload: { orderId: string, draft: ReviseApprovedBoqChangeOrderDraft }]
  remove: [order: BoqChangeOrderView]
  attach: [payload: { orderId: string, draft: BoqAttachmentDraft }]
  downloadAttachment: [attachment: BoqAttachmentView]
  removeAttachment: [attachment: BoqAttachmentView]
}>()

const { formModal, warning } = useKitUI()
const attachmentOrderId = shallowRef('')
const attachmentCategories = [
  ['我方指令单', 'our_directive'],
  ['甲方指令单', 'owner_directive'],
  ['报价', 'quotation'],
  ['算量', 'quantity_calculation'],
  ['施工照片', 'construction_photo'],
] as const
const attachmentCategoryLabel = Object.fromEntries(
  attachmentCategories.map(([label, key]) => [key, label]),
)
const { onChange, open: openFileDialog } = useFileDialog({
  accept: '.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png',
  multiple: false,
  reset: true,
})

const columns: KitTableColumn[] = [
  { field: 'code', title: '变更编号', width: 132, fixed: 'left', slot: 'code' },
  { field: 'name', title: '变更名称', minWidth: 180 },
  { field: 'changeType', title: '类型', width: 90, slot: 'changeType' },
  { field: 'status', title: '状态', width: 92, slot: 'status' },
  { field: 'directiveNo', title: '甲方指令单', width: 132 },
  { field: 'totalAmount', title: '变更金额', type: 'money', width: 128 },
  { field: 'approvedAt', title: '签证日期', type: 'date', width: 110 },
  { field: 'attachmentCount', title: '附件', width: 72, align: 'center' },
  { type: 'action', title: '操作', width: 56 },
]

const lineOptionByLabel = computed(() => new Map(props.workspace.lines.map(line => [
  `${line.itemName} · ${line.unitType || '通用'} · ${line.id.slice(-6)}`,
  line,
])))

const statusClass: Record<string, string> = {
  draft: 'chip',
  submitted: 'chip-brand',
  rejected: 'chip-danger',
  approved: 'chip-ok',
}

type ChangeRowActionKey = 'attach' | 'submit' | 'reject' | 'approve' | 'revise' | 'remove'

interface ChangeRowAction {
  key: ChangeRowActionKey
  label: string
  icon: string
  tone?: 'danger'
}

function rowActions(order: BoqChangeOrderView): ChangeRowAction[] {
  const actions: ChangeRowAction[] = []
  if (order.status === 'draft' || order.status === 'rejected') {
    actions.push({
      key: 'submit',
      label: order.status === 'rejected' ? '重新上报' : '上报',
      icon: 'i-lucide-send',
    })
  }
  if (order.status === 'submitted') {
    actions.push(
      { key: 'approve', label: '签证', icon: 'i-lucide-badge-check' },
      { key: 'reject', label: '退回', icon: 'i-lucide-undo-2' },
    )
  }
  if (order.status === 'approved') {
    actions.push({
      key: 'revise',
      label: '更正',
      icon: 'i-lucide-square-pen',
    })
  }
  actions.push(
    { key: 'attach', label: '登记附件', icon: 'i-lucide-paperclip' },
    { key: 'remove', label: '删除', icon: 'i-lucide-trash-2', tone: 'danger' },
  )
  return actions
}

async function createChange() {
  const operationOptions = ['调量', '调价', '新增']
  const targetOptions = ['— 新增分项 —', ...lineOptionByLabel.value.keys()]
  const values = await formModal({
    title: '新建甲方变更单',
    subtitle: '草稿保存后可上报；签证时才写入合同量/合同价并生成锁定台账行。',
    cols: 2,
    width: 720,
    saveText: '保存草稿',
    fields: [
      { key: 'code', label: '变更编号', required: true },
      { key: 'name', label: '变更名称', required: true },
      { key: 'operation', label: '变更类型', type: 'select', options: operationOptions, value: operationOptions[0], required: true },
      { key: 'target', label: '原清单行', type: 'select', options: targetOptions, value: targetOptions[1] ?? targetOptions[0], required: true },
      { key: 'itemName', label: '新增分项名称', placeholder: '仅“新增”时填写' },
      { key: 'unit', label: '单位', placeholder: '仅“新增”时填写' },
      { key: 'quantity', label: '新增量 / 调整量', type: 'number', value: 0, required: true },
      { key: 'unitPrice', label: '新增单价 / 调整后单价', type: 'number', value: 0 },
      { key: 'directiveNo', label: '甲方指令单编号' },
      { key: 'note', label: '说明', type: 'textarea', full: true },
    ],
  })
  if (!values)
    return
  const operation = values.operation === '新增' ? 'add' : values.operation === '调价' ? 'price' : 'qty'
  const target = lineOptionByLabel.value.get(String(values.target))
  if (operation !== 'add' && !target) {
    warning('调量或调价必须选择一条原清单行')
    return
  }
  const quantity = Number(values.quantity)
  const unitPrice = Number(values.unitPrice)
  const line = operation === 'add'
    ? {
        operation,
        itemName: String(values.itemName ?? ''),
        unit: String(values.unit ?? ''),
        qty: quantity,
        newUnitPrice: unitPrice,
        section: '变更新增',
        note: String(values.note ?? ''),
      } as const
    : operation === 'price'
      ? {
          operation,
          boqLineId: target!.id,
          newUnitPrice: unitPrice,
          note: String(values.note ?? ''),
        } as const
      : {
          operation,
          boqLineId: target!.id,
          deltaQty: quantity,
          note: String(values.note ?? ''),
        } as const
  emit('create', {
    projectId: props.workspace.projectId,
    contractId: props.workspace.contractId,
    code: String(values.code),
    name: String(values.name),
    changeType: operation,
    directiveNo: String(values.directiveNo ?? ''),
    directiveType: values.directiveNo ? 'changed' : '',
    note: String(values.note ?? ''),
    lines: [line],
  })
}

async function reject(order: BoqChangeOrderView) {
  const values = await formModal({
    title: `退回「${order.code}」`,
    saveText: '确认退回',
    fields: [{ key: 'reason', label: '退回原因', type: 'textarea', required: true }],
  })
  if (values)
    emit('transition', { orderId: order.id, target: 'rejected', note: String(values.reason) })
}

async function approve(order: BoqChangeOrderView) {
  const values = await formModal({
    title: `签证「${order.code}」`,
    subtitle: '签证后会写入合同量/合同价，并自动生成不可直接改金额的业主变洽签台账行。',
    saveText: '确认签证',
    fields: [{ key: 'date', label: '签证日期', type: 'date', value: toLocalDateInputValue(), required: true }],
  })
  if (values)
    emit('approve', { orderId: order.id, approvedAt: String(values.date) })
}

async function reviseApproved(order: BoqChangeOrderView) {
  const line = order.lines[0]
  if (order.lines.length !== 1 || !line) {
    warning('多明细或混合签证不能原地改写，请新建一张更正变更单')
    return
  }
  const fields: FieldDef[] = [
    { key: 'name', label: '变更名称', value: order.name, required: true },
    { key: 'directiveNo', label: '甲方指令单编号', value: order.directiveNo },
  ]
  if (line.operation === 'add' || line.operation === 'qty') {
    fields.push({
      key: 'quantity',
      label: line.operation === 'add' ? '新增工程量' : '调整工程量',
      type: 'number',
      value: line.deltaQty,
      required: true,
    })
  }
  if (line.operation === 'add' || line.operation === 'price') {
    fields.push({
      key: 'unitPrice',
      label: line.operation === 'add' ? '新增合同单价' : '调整后合同单价',
      type: 'number',
      value: line.newUnitPrice,
      required: true,
    })
  }
  fields.push({ key: 'lineNote', label: '明细说明', type: 'textarea', value: line.note, full: true })
  const values = await formModal({
    title: `更正已签证变更「${order.code}」`,
    subtitle: '保存前还需二次确认；原签证、锁定台账与结果清单会在同一事务中同步更正并写操作日志。',
    cols: 2,
    width: 680,
    saveText: '进入二次确认',
    fields,
  })
  if (!values)
    return
  emit('reviseApproved', {
    orderId: order.id,
    draft: {
      name: String(values.name),
      directiveNo: String(values.directiveNo ?? ''),
      line: {
        id: line.id,
        deltaQty: values.quantity === undefined ? undefined : Number(values.quantity),
        newUnitPrice: values.unitPrice === undefined ? undefined : Number(values.unitPrice),
        note: String(values.lineNote ?? ''),
      },
    },
  })
}

async function handleRowAction(action: string, order: BoqChangeOrderView) {
  switch (action as ChangeRowActionKey) {
    case 'attach':
      chooseAttachment(order.id)
      break
    case 'submit':
      emit('transition', {
        orderId: order.id,
        target: 'submitted',
        note: order.status === 'rejected' ? '补充资料后重新上报' : '已提交甲方',
      })
      break
    case 'reject':
      await reject(order)
      break
    case 'approve':
      await approve(order)
      break
    case 'revise':
      await reviseApproved(order)
      break
    case 'remove':
      emit('remove', order)
      break
  }
}

function chooseAttachment(orderId: string) {
  attachmentOrderId.value = orderId
  openFileDialog()
}

function fileContentBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('error', () => reject(reader.error ?? new Error('附件读取失败')), { once: true })
    reader.addEventListener('load', () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }, { once: true })
    reader.readAsDataURL(file)
  })
}

onChange(async (files) => {
  const file = files?.[0]
  const orderId = attachmentOrderId.value
  if (!file || !orderId)
    return
  const values = await formModal({
    title: '登记变更附件',
    fields: [{
      key: 'category',
      label: '附件类别',
      type: 'select',
      options: attachmentCategories.map(category => category[0]),
      value: attachmentCategories[0][0],
      required: true,
    }],
  })
  const category = attachmentCategories.find(candidate => candidate[0] === values?.category)
  if (values && category) {
    const contentBase64 = await fileContentBase64(file)
    emit('attach', {
      orderId,
      draft: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        contentBase64,
        category: category[1],
      },
    })
  }
})
</script>

<template>
  <div class="min-w-0">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-14px font-800 text-ink">
          甲方变更单
        </h2>
        <p class="mt-0.5 text-11px text-ink-soft">
          草稿 → 已上报 → 已打回 / 已签证；已签证金额自动进入业主台账。
        </p>
      </div>
      <button type="button" class="btn-accent" :disabled="busy" @click="createChange">
        <span class="i-lucide-plus mr-1" /> 新建变更单
      </button>
    </div>

    <KitTable
      class="boq-change-table"
      :columns="columns"
      :data="[...workspace.changes]"
      :loading="busy"
      :min-rows="10"
      empty="当前合同还没有变更单"
    >
      <template #code="{ row }">
        <NuxtLink
          v-if="row.ledgerId"
          :to="`/owner/change/${row.id}`"
          class="font-mono text-11px font-700 text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          :title="`打开已签证业主变更单 ${row.code}`"
        >
          {{ row.code }}
        </NuxtLink>
        <span v-else class="font-mono text-11px font-700 text-ink">
          {{ row.code }}
        </span>
      </template>
      <template #changeType="{ row }">
        {{ BOQ_CHANGE_TYPE_LABEL[row.changeType] }}
      </template>
      <template #status="{ row }">
        <span :class="statusClass[row.status]">{{ BOQ_CHANGE_STATUS_LABEL[row.status] }}</span>
      </template>
      <template #action="{ row }">
        <RowActionMenu
          :items="rowActions(row)"
          :label="`${row.code}变更单操作`"
          @select="handleRowAction($event, row)"
        />
      </template>
    </KitTable>

    <section v-if="workspace.changes.some(order => order.attachments.length)" class="mt-3 grid gap-2">
      <div
        v-for="order in workspace.changes.filter(change => change.attachments.length)"
        :key="order.id"
        class="panel flex min-w-0 flex-wrap items-center gap-2 px-3 py-2"
      >
        <strong class="mr-1 text-12px text-ink">{{ order.code }}</strong>
        <div
          v-for="attachment in order.attachments"
          :key="attachment.id"
          class="flex min-w-0 items-center gap-1 rounded-[var(--radius-btn)] bg-surface-2 px-2 py-1"
        >
          <span class="chip">{{ attachmentCategoryLabel[attachment.category] ?? attachment.category }}</span>
          <button
            type="button"
            class="max-w-52 truncate text-11px text-brand hover:underline"
            :title="`下载 ${attachment.fileName}`"
            @click="emit('downloadAttachment', attachment)"
          >
            {{ attachment.fileName }}
          </button>
          <button
            type="button"
            class="icon-btn h-6 w-6 text-danger"
            :aria-label="`删除附件 ${attachment.fileName}`"
            @click="emit('removeAttachment', attachment)"
          >
            <span class="i-lucide-x h-3 w-3" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
