<script setup lang="ts">
import type { CreateBoqChangeOrderDraft } from '~/lib/boq/change'
import type { BoqChangeOrderView, BoqWorkspace } from '~/lib/boq/read-model'
import type { KitTableColumn } from '~/lib/kit/table'
import type { BoqAttachmentDraft } from '~/stores/boq'
import { useFileDialog } from '@vueuse/core'
import { toLocalDateInputValue } from '~/lib/util/local-date'

const props = defineProps<{
  workspace: BoqWorkspace
  busy?: boolean
}>()

const emit = defineEmits<{
  create: [draft: CreateBoqChangeOrderDraft]
  transition: [payload: { orderId: string, target: 'submitted' | 'rejected', note: string }]
  approve: [payload: { orderId: string, approvedAt: string }]
  remove: [order: BoqChangeOrderView]
  attach: [payload: { orderId: string, draft: BoqAttachmentDraft }]
}>()

const { formModal, warning } = useKitUI()
const attachmentOrderId = shallowRef('')
const { onChange, open: openFileDialog } = useFileDialog({
  accept: '.pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png',
  multiple: false,
  reset: true,
})

const columns: KitTableColumn[] = [
  { field: 'code', title: '变更编号', width: 132, fixed: 'left' },
  { field: 'name', title: '变更名称', minWidth: 180 },
  { field: 'changeType', title: '类型', width: 90, slot: 'changeType' },
  { field: 'status', title: '状态', width: 92, slot: 'status' },
  { field: 'directiveNo', title: '甲方指令单', width: 132 },
  { field: 'totalAmount', title: '变更金额', type: 'money', width: 128 },
  { field: 'approvedAt', title: '签证日期', type: 'date', width: 110 },
  { field: 'attachmentCount', title: '附件', width: 72, align: 'center' },
  { type: 'action', title: '操作', width: 250 },
]

const lineOptionByLabel = computed(() => new Map(props.workspace.lines.map(line => [
  `${line.itemName} · ${line.unitType || '通用'} · ${line.id.slice(-6)}`,
  line,
])))

const operationLabel: Record<string, string> = {
  add: '新增',
  qty: '调量',
  price: '调价',
  mixed: '混合',
}

const statusLabel: Record<string, string> = {
  draft: '草稿',
  submitted: '已上报',
  rejected: '已打回',
  approved: '已签证',
}

const statusClass: Record<string, string> = {
  draft: 'chip',
  submitted: 'chip-brand',
  rejected: 'chip-danger',
  approved: 'chip-ok',
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

function chooseAttachment(orderId: string) {
  attachmentOrderId.value = orderId
  openFileDialog()
}

onChange(async (files) => {
  const file = files?.[0]
  const orderId = attachmentOrderId.value
  if (!file || !orderId)
    return
  const categories = [
    ['我方指令单', 'our_directive'],
    ['甲方指令单', 'owner_directive'],
    ['报价', 'quotation'],
    ['算量', 'quantity_calculation'],
    ['施工照片', 'construction_photo'],
  ] as const
  const values = await formModal({
    title: '登记变更附件',
    fields: [{
      key: 'category',
      label: '附件类别',
      type: 'select',
      options: categories.map(category => category[0]),
      value: categories[0][0],
      required: true,
    }],
  })
  const category = categories.find(candidate => candidate[0] === values?.category)
  if (values && category) {
    emit('attach', {
      orderId,
      draft: {
        fileName: file.name,
        fileSize: file.size,
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
      :columns="columns"
      :data="[...workspace.changes]"
      :loading="busy"
      :min-rows="10"
      empty="当前合同还没有变更单"
    >
      <template #changeType="{ row }">
        {{ operationLabel[row.changeType] ?? row.changeType }}
      </template>
      <template #status="{ row }">
        <span :class="statusClass[row.status]">{{ statusLabel[row.status] }}</span>
      </template>
      <template #action="{ row }">
        <div class="flex items-center justify-end gap-1">
          <button type="button" class="btn-ghost px-2 py-1 text-11px" @click="chooseAttachment(row.id)">
            附件
          </button>
          <button
            v-if="row.status === 'draft' || row.status === 'rejected'"
            type="button"
            class="btn-primary px-2 py-1 text-11px"
            @click="emit('transition', { orderId: row.id, target: 'submitted', note: row.status === 'rejected' ? '补充资料后重新上报' : '已提交甲方' })"
          >
            上报
          </button>
          <button v-if="row.status === 'submitted'" type="button" class="btn-ghost px-2 py-1 text-11px" @click="reject(row)">
            退回
          </button>
          <button v-if="row.status === 'submitted'" type="button" class="btn-primary px-2 py-1 text-11px" @click="approve(row)">
            签证
          </button>
          <button type="button" class="btn-danger px-2 py-1 text-11px" @click="emit('remove', row)">
            删除
          </button>
        </div>
      </template>
    </KitTable>
  </div>
</template>
