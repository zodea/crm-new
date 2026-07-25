<script setup lang="ts">
import type {
  CurrentTransactionFormDraft,
  ExpenseReimbursementFormDraft,
  F3FormKind,
  InvoiceAllocationDraft,
  InvoiceApplicationFormDraft,
  PaymentApplicationAllocationDraft,
  PaymentApplicationFormDraft,
  PaymentRecordFormDraft,
  ReceiptFormDraft,
  ReimbursementLineDraft,
  SettlementAllocationDraft,
} from '~/lib/finance/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import { computed } from 'vue'

type PageDraft
  = ReceiptFormDraft
    & InvoiceApplicationFormDraft
    & CurrentTransactionFormDraft
    & ExpenseReimbursementFormDraft
    & PaymentApplicationFormDraft
    & PaymentRecordFormDraft

const props = defineProps<{
  kind: F3FormKind
  draft: PageDraft
  fetchProjects: (keyword: string) => Promise<LookupOption[]>
  fetchCustomers: (keyword: string) => Promise<LookupOption[]>
  fetchSuppliers: (keyword: string) => Promise<LookupOption[]>
  fetchIncomeContracts: (keyword: string) => Promise<LookupOption[]>
  fetchExpenseContracts: (keyword: string) => Promise<LookupOption[]>
  fetchSettlements: (keyword: string) => Promise<LookupOption[]>
  fetchInvoices: (keyword: string) => Promise<LookupOption[]>
  fetchPaymentApplications: (keyword: string) => Promise<LookupOption[]>
}>()

const emit = defineEmits<{
  patch: [patch: Partial<PageDraft>]
}>()

function options(values: string[]) {
  return values.map(value => ({ key: value, label: value }))
}

const PAYMENT_METHOD_OPTIONS = options(['银行转账', '承兑汇票', '现金', '其他'])
const RECEIPT_REVIEW_OPTIONS = options(['待审核', '已审核', '已驳回'])
const INVOICE_TYPE_OPTIONS = options(['增值税专用发票', '增值税普通发票', '电子普通发票'])
const DIRECTION_OPTIONS = [
  { key: 'receipt', label: '收款' },
  { key: 'payment', label: '付款' },
]
const BIZ_TYPE_OPTIONS = options([
  '有合同-合同劳务',
  '有合同-材料',
  '有合同-专业分包',
  '有合同-机械',
  '有合同-其他',
  '无合同-零星采购',
  '预付款',
  '管理费',
  '项目费用',
  '公司付款',
])
const COST_OPTIONS = options(['合同劳务', '专业分包', '材料', '机械', '管理费', '项目费用', '其他'])
const INVOICE_STATE_OPTIONS = options(['先票后款', '先款后票', '无需发票'])
const SOURCE_OPTIONS = [
  { key: 'manual', label: '手工录入' },
  { key: 'image_ocr', label: '图片/PDF 识别' },
  { key: 'excel_import', label: 'Excel 导入' },
]

const isCompanyPayment = computed(() =>
  props.kind === 'payment_application' && props.draft.bizType === '公司付款',
)
const showsContract = computed(() =>
  props.kind === 'payment_application'
  && (props.draft.bizType?.startsWith('有合同-') || props.draft.bizType === '预付款'),
)
const showsSettlements = computed(() =>
  props.kind === 'payment_application'
  && Boolean(props.draft.bizType?.startsWith('有合同-')),
)
const showsInvoices = computed(() =>
  props.kind === 'payment_application' && props.draft.invoiceState !== '无需发票',
)
const reimbursementTotal = computed(() =>
  (props.draft.lines ?? []).reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
)
const settlementTotal = computed(() =>
  (props.draft.settlementAllocations ?? [])
    .reduce((sum, line) => sum + (Number(line.allocatedAmount) || 0), 0),
)
const invoiceTotal = computed(() =>
  (props.draft.invoiceAllocations ?? [])
    .reduce((sum, line) => sum + (Number(line.allocatedAmount) || 0), 0),
)
const paymentAllocationTotal = computed(() =>
  (props.draft.applicationAllocations ?? [])
    .reduce((sum, line) => sum + (Number(line.allocatedAmount) || 0), 0),
)
const applyAmount = computed(() => Number(props.draft.applyAmount) || 0)
const paymentAmount = computed(() => Number(props.draft.amount) || 0)

function patch(field: keyof PageDraft, value: unknown) {
  const next: Partial<PageDraft> = { [field]: value } as Partial<PageDraft>
  if (field === 'projectId') {
    if (props.kind === 'receipt' || props.kind === 'invoice_application')
      Object.assign(next, { contractId: null })
    if (props.kind === 'payment_application') {
      Object.assign(next, {
        contractId: null,
        settlementAllocations: [],
        invoiceAllocations: [],
      })
    }
  }
  if (field === 'supplierId' && props.kind === 'payment_application')
    Object.assign(next, { contractId: null, invoiceAllocations: [] })
  if (field === 'contractId' && props.kind === 'payment_application')
    Object.assign(next, { settlementAllocations: [] })
  if (field === 'bizType' && value === '公司付款')
    Object.assign(next, { projectId: null, contractId: null, settlementAllocations: [] })
  if (field === 'invoiceState' && value === '无需发票')
    Object.assign(next, { invoiceAllocations: [] })
  emit('patch', next)
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function inputNumber(event: Event): number {
  return Number((event.target as HTMLInputElement).value) || 0
}

function updateLines(lines: ReimbursementLineDraft[]) {
  emit('patch', { lines } as Partial<PageDraft>)
}

function addReimbursementLine() {
  updateLines([
    ...(props.draft.lines ?? []),
    { expenseItem: '', expenseDate: '', amount: 0, note: '' },
  ])
}

function patchReimbursementLine(index: number, patchValue: Partial<ReimbursementLineDraft>) {
  updateLines((props.draft.lines ?? []).map((line, current) =>
    current === index ? { ...line, ...patchValue } : line,
  ))
}

function removeReimbursementLine(index: number) {
  updateLines((props.draft.lines ?? []).filter((_, current) => current !== index))
}

function copyReimbursementLine(index: number) {
  const source = props.draft.lines?.[index]
  if (!source)
    return
  const next = [...(props.draft.lines ?? [])]
  next.splice(index + 1, 0, { ...source, id: undefined })
  updateLines(next)
}

function updateSettlementLines(lines: SettlementAllocationDraft[]) {
  emit('patch', { settlementAllocations: lines } as Partial<PageDraft>)
}

function addSettlementLine() {
  updateSettlementLines([
    ...(props.draft.settlementAllocations ?? []),
    { settlementId: null, allocatedAmount: 0, note: '' },
  ])
}

function patchSettlementLine(index: number, patchValue: Partial<SettlementAllocationDraft>) {
  updateSettlementLines((props.draft.settlementAllocations ?? []).map((line, current) =>
    current === index ? { ...line, ...patchValue } : line,
  ))
}

function removeSettlementLine(index: number) {
  updateSettlementLines(
    (props.draft.settlementAllocations ?? []).filter((_, current) => current !== index),
  )
}

function updateInvoiceLines(lines: InvoiceAllocationDraft[]) {
  emit('patch', { invoiceAllocations: lines } as Partial<PageDraft>)
}

function addInvoiceLine() {
  updateInvoiceLines([
    ...(props.draft.invoiceAllocations ?? []),
    { invoiceId: null, allocatedAmount: 0, note: '' },
  ])
}

function patchInvoiceLine(index: number, patchValue: Partial<InvoiceAllocationDraft>) {
  updateInvoiceLines((props.draft.invoiceAllocations ?? []).map((line, current) =>
    current === index ? { ...line, ...patchValue } : line,
  ))
}

function removeInvoiceLine(index: number) {
  updateInvoiceLines(
    (props.draft.invoiceAllocations ?? []).filter((_, current) => current !== index),
  )
}

function updatePaymentLines(lines: PaymentApplicationAllocationDraft[]) {
  emit('patch', { applicationAllocations: lines } as Partial<PageDraft>)
}

function addPaymentLine() {
  updatePaymentLines([
    ...(props.draft.applicationAllocations ?? []),
    { paymentApplicationId: null, allocatedAmount: 0, note: '' },
  ])
}

function patchPaymentLine(
  index: number,
  patchValue: Partial<PaymentApplicationAllocationDraft>,
) {
  updatePaymentLines((props.draft.applicationAllocations ?? []).map((line, current) =>
    current === index ? { ...line, ...patchValue } : line,
  ))
}

function removePaymentLine(index: number) {
  updatePaymentLines(
    (props.draft.applicationAllocations ?? []).filter((_, current) => current !== index),
  )
}
</script>

<template>
  <template v-if="kind === 'receipt'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">收款单号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">收款日期 *</span>
          <input :value="draft.receiptDate" type="date" class="field-input w-full" data-testid="finance-date" @input="patch('receiptDate', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-receipt-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">施工合同</span>
          <LookupSelect :model-value="draft.contractId" :fetch="fetchIncomeContracts" recent-key="finance-receipt-contract" :disabled-reason="draft.projectId ? undefined : '请先选择项目'" placeholder="检索施工合同" @update:model-value="patch('contractId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">付款方客户 *</span>
          <LookupSelect :model-value="draft.customerId" :fetch="fetchCustomers" recent-key="finance-receipt-customer" placeholder="检索客户" @update:model-value="patch('customerId', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">付款方账号</span>
          <input :value="draft.payerAccount" class="field-input w-full" @input="patch('payerAccount', inputValue($event))">
        </label>
      </div>
    </section>

    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader title="金额与方式" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">收款金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
        </label>
        <div class="field-block">
          <span class="field-label">收款方式</span>
          <SelectFilter :model-value="draft.paymentMethod" :options="PAYMENT_METHOD_OPTIONS" full-width aria-label="收款方式" @update:model-value="patch('paymentMethod', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">承兑汇票号</span>
          <input :value="draft.acceptanceBillNo" class="field-input w-full" @input="patch('acceptanceBillNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">汇票到期日</span>
          <input :value="draft.billDueDate" type="date" class="field-input w-full" @input="patch('billDueDate', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">收款期次</span>
          <input :value="draft.periodNo" class="field-input w-full" @input="patch('periodNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">银行流水号</span>
          <input :value="draft.bankSerialNo" class="field-input w-full font-mono" @input="patch('bankSerialNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">经办人</span>
          <input :value="draft.handler" class="field-input w-full" @input="patch('handler', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">审核状态</span>
          <SelectFilter :model-value="draft.reviewStatus" :options="RECEIPT_REVIEW_OPTIONS" full-width aria-label="审核状态" @update:model-value="patch('reviewStatus', $event)" />
        </div>
      </div>
    </section>
  </template>

  <template v-else-if="kind === 'invoice_application'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">申请编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">开票申请名称 *</span>
          <input :value="draft.name" class="field-input w-full" data-testid="finance-name" @input="patch('name', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-billing-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">施工合同</span>
          <LookupSelect :model-value="draft.contractId" :fetch="fetchIncomeContracts" recent-key="finance-billing-contract" :disabled-reason="draft.projectId ? undefined : '请先选择项目'" placeholder="检索施工合同" @update:model-value="patch('contractId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">购方客户 *</span>
          <LookupSelect :model-value="draft.customerId" :fetch="fetchCustomers" recent-key="finance-billing-customer" placeholder="检索客户" @update:model-value="patch('customerId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">发票类型</span>
          <SelectFilter :model-value="draft.invoiceType" :options="INVOICE_TYPE_OPTIONS" full-width aria-label="发票类型" @update:model-value="patch('invoiceType', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">购方名称快照 *</span>
          <input :value="draft.buyerNameSnapshot" class="field-input w-full" @input="patch('buyerNameSnapshot', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">购方税号快照 *</span>
          <input :value="draft.buyerTaxNoSnapshot" class="field-input w-full font-mono" @input="patch('buyerTaxNoSnapshot', inputValue($event))">
        </label>
      </div>
    </section>
    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader title="金额与税率" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">开票金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
        </label>
        <label class="field-block">
          <span class="field-label">税率（%）</span>
          <input :value="draft.taxRate" type="number" min="0" step="0.01" class="field-input w-full font-mono" @input="patch('taxRate', inputNumber($event))">
        </label>
        <label class="field-block">
          <span class="field-label">税额</span>
          <input :value="draft.taxAmount" type="number" min="0" step="0.01" class="field-input w-full font-mono" @input="patch('taxAmount', inputNumber($event))">
        </label>
        <div class="field-block">
          <span class="field-label">价税合计（只读）</span>
          <div class="field-input flex items-center bg-surface-2 font-mono">
            ¥ {{ ((Number(draft.amount) || 0) + (Number(draft.taxAmount) || 0)).toFixed(2) }}
          </div>
        </div>
        <label class="field-block form-span-full">
          <span class="field-label">开票内容</span>
          <textarea :value="draft.invoiceContent" rows="3" class="field-input w-full" @input="patch('invoiceContent', inputValue($event))" />
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">票面备注</span>
          <textarea :value="draft.invoiceRemark" rows="2" class="field-input w-full" @input="patch('invoiceRemark', inputValue($event))" />
        </label>
        <label class="field-block">
          <span class="field-label">申请人</span>
          <input :value="draft.applicant" class="field-input w-full" @input="patch('applicant', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">申请日期 *</span>
          <input :value="draft.applicationDate" type="date" class="field-input w-full" data-testid="finance-date" @input="patch('applicationDate', inputValue($event))">
        </label>
      </div>
    </section>
  </template>

  <template v-else-if="kind === 'current'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">单据编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">收付方向 *</span>
          <SelectFilter :model-value="draft.direction" :options="DIRECTION_OPTIONS" full-width aria-label="收付方向" @update:model-value="patch('direction', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-current-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">往来方 *</span>
          <input :value="draft.counterparty" class="field-input w-full" data-testid="finance-name" @input="patch('counterparty', inputValue($event))">
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">款项性质</span>
          <input :value="draft.purpose" class="field-input w-full" @input="patch('purpose', inputValue($event))">
        </label>
      </div>
    </section>
    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader title="金额与方式" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
        </label>
        <div class="field-block">
          <span class="field-label">收付方式</span>
          <SelectFilter :model-value="draft.paymentMethod" :options="PAYMENT_METHOD_OPTIONS" full-width aria-label="收付方式" @update:model-value="patch('paymentMethod', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">日期 *</span>
          <input :value="draft.transactionDate" type="date" class="field-input w-full" data-testid="finance-date" @input="patch('transactionDate', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">银行流水号</span>
          <input :value="draft.bankSerialNo" class="field-input w-full font-mono" @input="patch('bankSerialNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">经办人</span>
          <input :value="draft.handler" class="field-input w-full" @input="patch('handler', inputValue($event))">
        </label>
      </div>
    </section>
  </template>

  <template v-else-if="kind === 'reimbursement'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">报销单号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">报销人 *</span>
          <input :value="draft.applicant" class="field-input w-full" data-testid="finance-name" @input="patch('applicant', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">归属项目（可空=公司开支）</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-reimbursement-project" placeholder="留空表示公司开支" @update:model-value="patch('projectId', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">费用类别</span>
          <input :value="draft.category" class="field-input w-full" @input="patch('category', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">报销日期 *</span>
          <input :value="draft.reimbursementDate" type="date" class="field-input w-full" data-testid="finance-date" @input="patch('reimbursementDate', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">发票张数</span>
          <input :value="draft.invoiceCount" type="number" min="0" step="1" class="field-input w-full" @input="patch('invoiceCount', inputNumber($event))">
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">报销事由</span>
          <textarea :value="draft.reason" rows="2" class="field-input w-full" @input="patch('reason', inputValue($event))" />
        </label>
      </div>
    </section>
    <section id="section-lines" class="panel scroll-mt-4 overflow-hidden">
      <div class="flex items-center gap-3 border-b border-line px-4 py-3">
        <SectionHeader title="费用明细" />
        <div class="ml-auto font-mono text-13px font-700 text-brand-deep">
          合计 ¥ {{ reimbursementTotal.toFixed(2) }}
        </div>
        <KitButton size="sm" variant="secondary" data-testid="add-reimbursement-line" @click="addReimbursementLine">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新增行
        </KitButton>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-780px w-full border-collapse text-12px">
          <thead class="bg-surface-2 text-ink-soft">
            <tr>
              <th class="px-3 py-2 text-left">
                费用项目 *
              </th>
              <th class="w-36 px-3 py-2 text-left">
                发生日期
              </th>
              <th class="w-36 px-3 py-2 text-right">
                金额 *
              </th>
              <th class="px-3 py-2 text-left">
                备注
              </th>
              <th class="w-20 px-3 py-2">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in draft.lines ?? []" :key="line.id ?? index" class="border-t border-line">
              <td class="p-2">
                <input :value="line.expenseItem" class="field-input w-full" :data-testid="`reimbursement-item-${index}`" @input="patchReimbursementLine(index, { expenseItem: inputValue($event) })">
              </td>
              <td class="p-2">
                <input :value="line.expenseDate" type="date" class="field-input w-full" @input="patchReimbursementLine(index, { expenseDate: inputValue($event) })">
              </td>
              <td class="p-2">
                <input :value="line.amount" type="number" min="0" step="0.01" class="field-input w-full text-right font-mono" :data-testid="`reimbursement-amount-${index}`" @input="patchReimbursementLine(index, { amount: inputNumber($event) })">
              </td>
              <td class="p-2">
                <input :value="line.note" class="field-input w-full" @input="patchReimbursementLine(index, { note: inputValue($event) })">
              </td>
              <td class="p-2 text-center">
                <button type="button" class="icon-btn" title="复制" @click="copyReimbursementLine(index)">
                  <span class="i-lucide-copy" aria-hidden="true" />
                </button>
                <button type="button" class="icon-btn-danger" title="删除" @click="removeReimbursementLine(index)">
                  <span class="i-lucide-trash-2" aria-hidden="true" />
                </button>
              </td>
            </tr>
            <tr v-if="!(draft.lines?.length)">
              <td colspan="5" class="px-4 py-8 text-center text-ink-faint">
                暂无明细，请新增一行
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <template v-else-if="kind === 'payment_application'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">付款申请编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">付款申请名称 *</span>
          <input :value="draft.name" class="field-input w-full" data-testid="finance-name" @input="patch('name', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">业务类型 *</span>
          <SelectFilter :model-value="draft.bizType" :options="BIZ_TYPE_OPTIONS" full-width aria-label="业务类型" @update:model-value="patch('bizType', $event)" />
        </div>
        <div v-if="!isCompanyPayment" class="field-block">
          <span class="field-label">项目 *</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-payment-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">收款单位</span>
          <LookupSelect :model-value="draft.supplierId" :fetch="fetchSuppliers" recent-key="finance-payment-supplier" placeholder="检索分供方" @update:model-value="patch('supplierId', $event)" />
        </div>
        <div v-if="showsContract" class="field-block">
          <span class="field-label">关联合同 *</span>
          <LookupSelect :model-value="draft.contractId" :fetch="fetchExpenseContracts" recent-key="finance-payment-contract" :disabled-reason="draft.projectId ? undefined : '请先选择项目'" placeholder="检索支出合同" @update:model-value="patch('contractId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">成本分类</span>
          <SelectFilter :model-value="draft.costName" :options="COST_OPTIONS" full-width aria-label="成本分类" @update:model-value="patch('costName', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">申请金额 *</span>
          <input :value="draft.applyAmount" type="number" min="0" step="0.01" class="field-input w-full font-mono" data-testid="finance-amount" @input="patch('applyAmount', inputNumber($event))">
        </label>
        <label class="field-block">
          <span class="field-label">申请日期 *</span>
          <input :value="draft.applyDate" type="date" class="field-input w-full" data-testid="finance-date" @input="patch('applyDate', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">申请人 *</span>
          <input :value="draft.applicant" class="field-input w-full" @input="patch('applicant', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">回票类型 *</span>
          <SelectFilter :model-value="draft.invoiceState" :options="INVOICE_STATE_OPTIONS" full-width aria-label="回票类型" @update:model-value="patch('invoiceState', $event)" />
        </div>
        <label class="field-block form-span-full">
          <span class="field-label">付款内容</span>
          <textarea :value="draft.payContent" rows="3" class="field-input w-full" @input="patch('payContent', inputValue($event))" />
        </label>
      </div>
    </section>

    <section v-if="showsSettlements" id="section-settlements" class="panel scroll-mt-4 overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <SectionHeader title="关联结算" />
        <span class="ml-auto text-12px" :class="Math.abs(applyAmount - settlementTotal) < 0.0001 ? 'text-success' : 'text-warning'">
          已关联 ¥ {{ settlementTotal.toFixed(2) }} · 差额 ¥ {{ (applyAmount - settlementTotal).toFixed(2) }}
        </span>
        <KitButton size="sm" variant="secondary" data-testid="add-settlement-allocation" @click="addSettlementLine">
          新增结算
        </KitButton>
      </div>
      <div class="grid gap-2 p-3">
        <div v-for="(line, index) in draft.settlementAllocations ?? []" :key="line.id ?? index" class="grid gap-2 rounded-[var(--radius-control)] border border-line p-3 md:grid-cols-[minmax(220px,1fr)_150px_minmax(160px,1fr)_36px]">
          <LookupSelect :model-value="line.settlementId" :fetch="fetchSettlements" :recent-key="`finance-settlement-${index}`" :disabled-reason="draft.contractId ? undefined : '请先选择关联合同'" placeholder="选择真实结算单" @update:model-value="patchSettlementLine(index, { settlementId: $event })" />
          <input :value="line.allocatedAmount" type="number" min="0" step="0.01" class="field-input w-full text-right font-mono" aria-label="本次关联结算金额" @input="patchSettlementLine(index, { allocatedAmount: inputNumber($event) })">
          <input :value="line.note" class="field-input w-full" placeholder="备注" @input="patchSettlementLine(index, { note: inputValue($event) })">
          <button type="button" class="icon-btn-danger" title="删除" @click="removeSettlementLine(index)">
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </div>
        <p v-if="!(draft.settlementAllocations?.length)" class="py-5 text-center text-12px text-ink-faint">
          请选择当前项目/合同的真实支出结算单
        </p>
      </div>
    </section>

    <section v-if="showsInvoices" id="section-invoices" class="panel scroll-mt-4 overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <SectionHeader title="关联发票" />
        <span class="ml-auto text-12px text-ink-soft">
          已关联 ¥ {{ invoiceTotal.toFixed(2) }} ·
          {{ draft.invoiceState === '先款后票' ? '待回票' : '差额' }}
          ¥ {{ Math.max(applyAmount - invoiceTotal, 0).toFixed(2) }}
        </span>
        <KitButton size="sm" variant="secondary" data-testid="add-invoice-allocation" @click="addInvoiceLine">
          新增发票
        </KitButton>
      </div>
      <div class="grid gap-2 p-3">
        <div v-for="(line, index) in draft.invoiceAllocations ?? []" :key="line.id ?? index" class="grid gap-2 rounded-[var(--radius-control)] border border-line p-3 md:grid-cols-[minmax(220px,1fr)_150px_minmax(160px,1fr)_36px]">
          <LookupSelect :model-value="line.invoiceId" :fetch="fetchInvoices" :recent-key="`finance-invoice-allocation-${index}`" placeholder="选择真实发票" @update:model-value="patchInvoiceLine(index, { invoiceId: $event })" />
          <input :value="line.allocatedAmount" type="number" min="0" step="0.01" class="field-input w-full text-right font-mono" aria-label="本次关联发票金额" @input="patchInvoiceLine(index, { allocatedAmount: inputNumber($event) })">
          <input :value="line.note" class="field-input w-full" placeholder="备注" @input="patchInvoiceLine(index, { note: inputValue($event) })">
          <button type="button" class="icon-btn-danger" title="删除" @click="removeInvoiceLine(index)">
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </div>
        <p v-if="!(draft.invoiceAllocations?.length)" class="py-5 text-center text-12px text-ink-faint">
          先款后票允许无票提交；后续可补关联
        </p>
      </div>
    </section>

    <section id="section-approval" class="panel scroll-mt-4 p-4">
      <SectionHeader title="审批与支付" />
      <div class="form-fields-grid mt-3">
        <label v-if="draft.bizType === '预付款'" class="field-block">
          <span class="field-label">本次扣除预付款金额</span>
          <input :value="draft.prepayDeduct" type="number" min="0" step="0.01" class="field-input w-full font-mono" @input="patch('prepayDeduct', inputNumber($event))">
        </label>
        <label v-if="draft.bizType === '预付款'" class="field-block">
          <span class="field-label">扣除说明</span>
          <input :value="draft.prepayNote" class="field-input w-full" @input="patch('prepayNote', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">本期批复金额</span>
          <input :value="draft.approvedAmount" type="number" min="0" step="0.01" class="field-input w-full font-mono" @input="patch('approvedAmount', inputNumber($event))">
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">审批备注</span>
          <textarea :value="draft.approvalNote" rows="2" class="field-input w-full" @input="patch('approvalNote', inputValue($event))" />
        </label>
      </div>
    </section>
  </template>

  <template v-else-if="kind === 'payment_record'">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <SectionHeader title="基本信息" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">支付编号</span>
          <input :value="draft.no" class="field-input w-full font-mono" data-testid="finance-no" @input="patch('no', inputValue($event))">
        </label>
        <div class="field-block">
          <span class="field-label">项目（公司付款可空）</span>
          <LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" recent-key="finance-record-project" placeholder="检索项目" @update:model-value="patch('projectId', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">收款分供方</span>
          <LookupSelect :model-value="draft.supplierId" :fetch="fetchSuppliers" recent-key="finance-record-supplier" placeholder="检索分供方" @update:model-value="patch('supplierId', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">收款方名称 *</span>
          <input :value="draft.payeeName" class="field-input w-full" data-testid="finance-name" @input="patch('payeeName', inputValue($event))">
        </label>
        <label class="field-block form-span-full">
          <span class="field-label">付款用途</span>
          <input :value="draft.purpose" class="field-input w-full" @input="patch('purpose', inputValue($event))">
        </label>
      </div>
    </section>

    <section id="section-amount" class="panel scroll-mt-4 p-4">
      <SectionHeader title="支付与账户" />
      <div class="form-fields-grid mt-3">
        <label class="field-block">
          <span class="field-label">支付日期 *</span>
          <input :value="draft.paymentDate" type="date" class="field-input w-full" data-testid="finance-date" @input="patch('paymentDate', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">支付金额 *</span>
          <input :value="draft.amount" type="number" min="0" step="0.01" class="field-input w-full font-mono" data-testid="finance-amount" @input="patch('amount', inputNumber($event))">
        </label>
        <div class="field-block">
          <span class="field-label">支付方式</span>
          <SelectFilter :model-value="draft.paymentMethod" :options="PAYMENT_METHOD_OPTIONS" full-width aria-label="支付方式" @update:model-value="patch('paymentMethod', $event)" />
        </div>
        <label class="field-block">
          <span class="field-label">付款凭证号 *</span>
          <input :value="draft.voucherNo" class="field-input w-full font-mono" @input="patch('voucherNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">银行流水号 *</span>
          <input :value="draft.bankSerialNo" class="field-input w-full font-mono" data-testid="payment-bank-serial" @input="patch('bankSerialNo', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">收款账户名</span>
          <input :value="draft.payeeAccount" class="field-input w-full" @input="patch('payeeAccount', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">开户行</span>
          <input :value="draft.payeeBank" class="field-input w-full" @input="patch('payeeBank', inputValue($event))">
        </label>
        <label class="field-block">
          <span class="field-label">银行账号</span>
          <input :value="draft.payeeBankAccount" class="field-input w-full font-mono" @input="patch('payeeBankAccount', inputValue($event))">
        </label>
      </div>
    </section>

    <section id="section-allocations" class="panel scroll-mt-4 overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <SectionHeader title="付款申请分摊" />
        <span class="ml-auto text-12px" :class="Math.abs(paymentAmount - paymentAllocationTotal) < 0.0001 ? 'text-success' : 'text-warning'">
          已分摊 ¥ {{ paymentAllocationTotal.toFixed(2) }} · 差额 ¥ {{ (paymentAmount - paymentAllocationTotal).toFixed(2) }}
        </span>
        <KitButton size="sm" variant="secondary" data-testid="add-payment-allocation" @click="addPaymentLine">
          新增分摊
        </KitButton>
      </div>
      <div class="grid gap-2 p-3">
        <div v-for="(line, index) in draft.applicationAllocations ?? []" :key="line.id ?? index" class="grid gap-2 rounded-[var(--radius-control)] border border-line p-3 md:grid-cols-[minmax(220px,1fr)_150px_minmax(160px,1fr)_36px]">
          <LookupSelect :model-value="line.paymentApplicationId" :fetch="fetchPaymentApplications" :recent-key="`finance-payment-record-${index}`" placeholder="选择付款申请" @update:model-value="patchPaymentLine(index, { paymentApplicationId: $event })" />
          <input :value="line.allocatedAmount" type="number" min="0" step="0.01" class="field-input w-full text-right font-mono" aria-label="本次支付分摊金额" @input="patchPaymentLine(index, { allocatedAmount: inputNumber($event) })">
          <input :value="line.note" class="field-input w-full" placeholder="备注" @input="patchPaymentLine(index, { note: inputValue($event) })">
          <button type="button" class="icon-btn-danger" title="删除" @click="removePaymentLine(index)">
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </div>
        <p v-if="!(draft.applicationAllocations?.length)" class="py-5 text-center text-12px text-ink-faint">
          确认前，分摊合计必须等于支付金额
        </p>
      </div>
    </section>

    <section id="section-review" class="panel scroll-mt-4 p-4">
      <SectionHeader title="识别与人工核对" />
      <div class="form-fields-grid mt-3">
        <div class="field-block">
          <span class="field-label">来源</span>
          <SelectFilter :model-value="draft.source" :options="SOURCE_OPTIONS" full-width aria-label="支付来源" @update:model-value="patch('source', $event)" />
        </div>
        <div class="field-block">
          <span class="field-label">人工核对状态</span>
          <div class="field-input flex items-center bg-surface-2">
            {{ draft.confirmationStatus === 'confirmed' ? '已确认' : draft.confirmationStatus === 'needs_review' ? '待核对' : '草稿' }}
          </div>
        </div>
        <p class="form-span-full rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-12px text-warning-deep">
          OCR 只负责预填。无论识别置信度多高，都必须由人工点击“确认支付”；未确认记录不进入资金汇总。
        </p>
      </div>
    </section>
  </template>
</template>
