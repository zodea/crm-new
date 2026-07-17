<script setup lang="ts">
import type { DeliveryAmountSource } from '~/lib/delivery/review'
import type { DeliveryLineDraft, DeliveryRecord } from '~/stores/delivery-record'
import { calculatedDeliveryAmount } from '~/lib/delivery/review'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  record?: DeliveryRecord | null
}>()

const emit = defineEmits<{
  saved: [id: string]
}>()

const open = defineModel<boolean>('open', { required: true })
const store = useDeliveryRecordStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const { confirm, success, warning, error } = useKitUI()

interface EditableLine extends Omit<DeliveryLineDraft, 'amount' | 'amountSource'> {
  key: number
  amount: number | null
  amountSource: DeliveryAmountSource
}

let lineKey = 0
const saving = shallowRef(false)
const form = reactive({
  projectId: '',
  supplierId: '',
  orderNo: '',
  deliveryDate: '',
  note: '',
  lines: [] as EditableLine[],
})

const title = computed(() => props.record ? `编辑送货单 · ${props.record.orderNo || '未编号'}` : '新增送货单')

function newLine(source: Partial<DeliveryLineDraft> = {}): EditableLine {
  lineKey += 1
  const qty = source.qty ?? null
  const unitPrice = source.unitPrice ?? null
  return {
    key: lineKey,
    materialName: source.materialName ?? '',
    spec: source.spec ?? '',
    unit: source.unit ?? '',
    qty,
    unitPrice,
    amount: source.amount === undefined ? calculatedDeliveryAmount({ qty, unitPrice }) : source.amount,
    amountSource: source.amountSource ?? (source.amount === undefined ? 'calculated' : 'manual'),
    note: source.note ?? '',
  }
}

function resetForm() {
  const record = props.record
  form.projectId = record?.projectId ?? ''
  form.supplierId = record?.supplierId ?? ''
  form.orderNo = record?.orderNo ?? ''
  form.deliveryDate = record?.deliveryDate ?? new Date().toISOString().slice(0, 10)
  form.note = record?.note ?? ''
  form.lines = record?.lines.length
    ? record.lines.map(line => newLine(line))
    : [newLine()]
}

watch(() => open.value, (isOpen) => {
  if (!isOpen)
    return
  resetForm()
  if (!projectStore.list.length)
    projectStore.load()
  if (!supplierStore.list.length)
    supplierStore.load()
})

function lineAmount(line: EditableLine): number {
  return line.amount ?? 0
}

function numberValue(event: Event): number | null {
  const rawValue = (event.target as HTMLInputElement).value.trim()
  if (!rawValue)
    return null
  const value = Number(rawValue)
  return Number.isFinite(value) ? value : null
}

function updateLineFactor(line: EditableLine, field: 'qty' | 'unitPrice', event: Event) {
  line[field] = numberValue(event)
  if (line.amountSource === 'calculated')
    line.amount = calculatedDeliveryAmount(line)
}

function updateLineAmount(line: EditableLine, event: Event) {
  line.amount = numberValue(event)
  line.amountSource = 'manual'
}

const totalAmount = computed(() => form.lines.reduce((sum, line) => sum + lineAmount(line), 0))

function addLine() {
  form.lines.push(newLine())
}

function removeLine(index: number) {
  if (form.lines.length === 1) {
    warning('送货单至少保留一条材料明细')
    return
  }
  form.lines.splice(index, 1)
}

async function save() {
  if (saving.value)
    return
  if (!form.projectId) {
    warning('送货单必须选择项目')
    return
  }
  if (!form.lines.some(line => line.materialName.trim())) {
    warning('至少填写一条材料明细')
    return
  }
  if (props.record?.archived) {
    const label = props.record.orderNo || props.record.id
    const confirmed = await confirm({
      variant: 'simple',
      title: '修改已归档送货单',
      message: `送货单「${label}」已归档。确认继续修改单据信息和材料明细？`,
      confirmLabel: '继续修改',
    })
    if (!confirmed)
      return
  }

  saving.value = true
  try {
    const input = {
      projectId: form.projectId,
      supplierId: form.supplierId || null,
      orderNo: form.orderNo,
      deliveryDate: form.deliveryDate,
      note: form.note,
      lines: form.lines.map(({ key: _key, ...line }) => line),
    }
    const id = props.record?.id ?? await store.add(input)
    if (props.record) {
      const logId = await store.update(props.record.id, input)
      if (!logId) {
        error('保存失败：送货单不存在或已删除')
        return
      }
    }
    success(props.record ? '送货单已更新' : '送货单已新增')
    open.value = false
    emit('saved', id)
  }
  catch (caught) {
    error(caught instanceof Error ? caught.message : '送货单保存失败')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="title"
    :save-label="saving ? '保存中…' : '保存送货单'"
    width="min(1040px, 96vw)"
    @save="save"
    @cancel="open = false"
  >
    <div class="flex flex-col gap-5">
      <section>
        <SectionHeader title="单据信息" subtitle="送货单必须归项目，分供方可稍后补齐" />
        <div class="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label class="field-label">所属项目 <span class="text-danger">*</span></label>
            <select v-model="form.projectId" class="field-input w-full">
              <option value="" disabled>
                请选择项目
              </option>
              <option v-for="project in projectStore.list" :key="project.id" :value="project.id">
                {{ project.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="field-label">分供方</label>
            <select v-model="form.supplierId" class="field-input w-full">
              <option value="">
                未区分分供方
              </option>
              <option v-for="supplier in supplierStore.list" :key="supplier.id" :value="supplier.id">
                {{ supplier.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="field-label">送货单号</label>
            <input v-model="form.orderNo" class="field-input w-full font-mono" placeholder="例如 SH-2026-0715-001">
          </div>
          <div>
            <label class="field-label">送货日期</label>
            <input v-model="form.deliveryDate" type="date" class="field-input w-full font-mono">
          </div>
          <div class="col-span-2">
            <label class="field-label">备注</label>
            <input v-model="form.note" class="field-input w-full" placeholder="车辆、批次或复核说明">
          </div>
        </div>
      </section>

      <section>
        <div class="mb-3 flex items-center gap-3">
          <SectionHeader title="材料明细" subtitle="默认按数量×单价补金额；手改金额后不再覆盖" />
          <div class="flex-1" />
          <button type="button" class="btn-secondary" @click="addLine">
            <span class="i-lucide-plus mr-1 text-13px" /> 添加一行
          </button>
        </div>

        <div class="overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table class="min-w-[880px] w-full text-12px">
            <thead class="bg-surface-2 text-ink-soft">
              <tr>
                <th class="w-10 px-2 py-2 text-center">
                  #
                </th>
                <th class="min-w-44 px-2 py-2 text-left">
                  材料名称 *
                </th>
                <th class="min-w-32 px-2 py-2 text-left">
                  规格型号
                </th>
                <th class="w-20 px-2 py-2 text-left">
                  单位
                </th>
                <th class="w-28 px-2 py-2 text-right">
                  数量
                </th>
                <th class="w-28 px-2 py-2 text-right">
                  单价
                </th>
                <th class="w-32 px-2 py-2 text-right">
                  金额
                </th>
                <th class="w-20 px-2 py-2 text-center">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(line, index) in form.lines" :key="line.key" class="border-t border-line">
                <td class="px-2 py-2 text-center font-mono text-ink-faint">
                  {{ index + 1 }}
                </td>
                <td class="px-1 py-1">
                  <input v-model="line.materialName" class="field-input w-full" placeholder="材料名称">
                </td>
                <td class="px-1 py-1">
                  <input v-model="line.spec" class="field-input w-full" placeholder="规格">
                </td>
                <td class="px-1 py-1">
                  <input v-model="line.unit" class="field-input w-full" placeholder="单位">
                </td>
                <td class="px-1 py-1">
                  <input :value="line.qty ?? ''" type="number" step="0.001" class="field-input w-full text-right font-mono" @input="updateLineFactor(line, 'qty', $event)">
                </td>
                <td class="px-1 py-1">
                  <input :value="line.unitPrice ?? ''" type="number" step="0.01" class="field-input w-full text-right font-mono" @input="updateLineFactor(line, 'unitPrice', $event)">
                </td>
                <td class="px-1 py-1">
                  <input :value="line.amount ?? ''" type="number" step="0.01" class="field-input w-full text-right font-mono font-700" title="人工修改后不会被数量/单价覆盖" @input="updateLineAmount(line, $event)">
                </td>
                <td class="px-2 py-2 text-center">
                  <button type="button" class="icon-btn-danger" title="删除明细" @click="removeLine(index)">
                    <span class="i-lucide-trash-2 text-13px" />
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot class="border-t border-line bg-surface-2">
              <tr>
                <td colspan="6" class="px-3 py-2 text-right font-600 text-ink-soft">
                  金额合计
                </td>
                <td class="px-2 py-2 text-right font-mono text-14px font-800 text-brand-deep">
                  {{ yuan(totalAmount) }}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  </FormDialog>
</template>
