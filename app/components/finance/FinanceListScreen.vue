<script setup lang="ts">
import type { F3FormKind } from '~/lib/finance/forms'
import type { KitTableColumn } from '~/lib/kit/table'
import { select } from '~/lib/db/connection'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'
import { F3_FORM_META, financeFormPath } from '~/lib/finance/page'
import { yuan } from '~/lib/util/money'

interface FinanceListRow {
  id: string
  no: string
  name: string
  projectName: string
  partyName: string
  amount: number
  date: string
  status: string
}

const props = defineProps<{
  kind: F3FormKind
}>()

const meta = computed(() => F3_FORM_META[props.kind])
const rows = shallowRef<FinanceListRow[]>([])
const loading = shallowRef(false)
const search = shallowRef('')

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword)
    return rows.value
  return rows.value.filter(row =>
    [row.no, row.name, row.projectName, row.partyName, row.status]
      .some(value => value.toLowerCase().includes(keyword)),
  )
})

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: '名称/对象', minWidth: 220, fixed: 'left', slot: 'name' },
  { field: 'no', title: '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 160 },
  { field: 'partyName', title: '关联方/类型', minWidth: 180 },
  { field: 'amount', title: '金额', type: 'money', width: 140 },
  { field: 'date', title: '日期', type: 'date', width: 128 },
  { field: 'status', title: '状态', width: 110, slot: 'status' },
  { title: '操作', type: 'action', width: 72 },
]

function mapRows(source: Array<Record<string, unknown>>): FinanceListRow[] {
  return source.map(row => ({
    id: String(row.id),
    no: String(row.no ?? ''),
    name: String(row.display_name ?? ''),
    projectName: String(row.project_name ?? ''),
    partyName: String(row.party_name ?? ''),
    amount: Number(row.display_amount) || 0,
    date: String(row.display_date ?? ''),
    status: String(row.display_status ?? ''),
  }))
}

async function load() {
  loading.value = true
  try {
    let result: Array<Record<string, unknown>>
    switch (props.kind) {
      case 'receipt':
        result = await select(`
          ${hiddenCtesFor('receipt_registrations')}
          SELECT receipt.id, receipt.no,
                 COALESCE(customer.name, receipt.payer_account, '') AS display_name,
                 COALESCE(project.name, '') AS project_name,
                 COALESCE(contract.name, '') AS party_name,
                 receipt.amount AS display_amount,
                 receipt.receipt_date AS display_date,
                 receipt.status AS display_status
          FROM receipt_registrations AS receipt
          LEFT JOIN projects AS project ON project.id = receipt.project_id
          LEFT JOIN customers AS customer ON customer.id = receipt.customer_id
          LEFT JOIN contracts AS contract ON contract.id = receipt.contract_id
          WHERE ${visibleCond('receipt_registrations', 'receipt')}
          ORDER BY receipt.created_at DESC
        `)
        break
      case 'invoice_application':
        result = await select(`
          ${hiddenCtesFor('invoice_applications')}
          SELECT application.id, application.no,
                 application.name AS display_name,
                 COALESCE(project.name, '') AS project_name,
                 application.buyer_name_snapshot AS party_name,
                 application.amount + application.tax_amount AS display_amount,
                 application.application_date AS display_date,
                 application.status AS display_status
          FROM invoice_applications AS application
          LEFT JOIN projects AS project ON project.id = application.project_id
          WHERE ${visibleCond('invoice_applications', 'application')}
          ORDER BY application.created_at DESC
        `)
        break
      case 'current':
        result = await select(`
          ${hiddenCtesFor('current_transactions')}
          SELECT current_row.id, current_row.no,
                 current_row.counterparty AS display_name,
                 COALESCE(project.name, '') AS project_name,
                 CASE current_row.direction WHEN 'receipt' THEN '收款' ELSE '付款' END AS party_name,
                 current_row.amount AS display_amount,
                 current_row.transaction_date AS display_date,
                 current_row.status AS display_status
          FROM current_transactions AS current_row
          LEFT JOIN projects AS project ON project.id = current_row.project_id
          WHERE ${visibleCond('current_transactions', 'current_row')}
          ORDER BY current_row.created_at DESC
        `)
        break
      case 'reimbursement':
        result = await select(`
          ${hiddenCtesFor('expense_reimbursements', 'expense_reimbursement_lines')}
          SELECT reimbursement.id, reimbursement.no,
                 reimbursement.applicant AS display_name,
                 COALESCE(project.name, '公司开支') AS project_name,
                 reimbursement.category AS party_name,
                 COALESCE((
                   SELECT SUM(line.amount)
                   FROM expense_reimbursement_lines AS line
                   WHERE line.reimbursement_id = reimbursement.id
                     AND ${visibleCond('expense_reimbursement_lines', 'line')}
                 ), 0) AS display_amount,
                 reimbursement.reimbursement_date AS display_date,
                 reimbursement.status AS display_status
          FROM expense_reimbursements AS reimbursement
          LEFT JOIN projects AS project ON project.id = reimbursement.project_id
          WHERE ${visibleCond('expense_reimbursements', 'reimbursement')}
          ORDER BY reimbursement.created_at DESC
        `)
        break
      case 'payment_application':
        result = await select(`
          ${hiddenCtesFor('payment_applications')}
          SELECT application.id, application.no,
                 application.name AS display_name,
                 COALESCE(project.name, '公司付款') AS project_name,
                 COALESCE(supplier.name, application.biz_type) AS party_name,
                 application.apply_amount AS display_amount,
                 application.apply_date AS display_date,
                 application.status AS display_status
          FROM payment_applications AS application
          LEFT JOIN projects AS project ON project.id = application.project_id
          LEFT JOIN suppliers AS supplier ON supplier.id = application.supplier_id
          WHERE ${visibleCond('payment_applications', 'application')}
          ORDER BY application.created_at DESC
        `)
        break
      case 'payment_record':
        result = await select(`
          ${hiddenCtesFor('payment_records')}
          SELECT payment.id, payment.no,
                 payment.payee_name AS display_name,
                 COALESCE(project.name, '公司付款') AS project_name,
                 payment.purpose AS party_name,
                 payment.amount AS display_amount,
                 payment.payment_date AS display_date,
                 CASE payment.confirmation_status
                   WHEN 'confirmed' THEN '已确认'
                   WHEN 'needs_review' THEN '待核对'
                   ELSE '草稿'
                 END AS display_status
          FROM payment_records AS payment
          LEFT JOIN projects AS project ON project.id = payment.project_id
          WHERE ${visibleCond('payment_records', 'payment')}
          ORDER BY payment.created_at DESC
        `)
        break
    }
    rows.value = mapRows(result)
  }
  finally {
    loading.value = false
  }
}

function openCreate() {
  void navigateTo(financeFormPath(props.kind))
}

function openEdit(row: FinanceListRow) {
  void navigateTo(financeFormPath(props.kind, row.id))
}

onMounted(() => {
  void load()
})
onActivated(() => {
  void load()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <header class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <div>
        <h1 class="text-17px font-800 text-ink">
          {{ meta.label }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          {{ meta.subtitle }}
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <SearchInput v-model="search" placeholder="搜索名称、编号、项目或关联方" class="w-68" />
        <KitButton variant="secondary" :loading="loading" @click="load">
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />刷新
        </KitButton>
        <KitButton data-testid="create-finance-form" @click="openCreate">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新建{{ meta.label }}
        </KitButton>
      </div>
    </header>

    <div class="panel overflow-hidden">
      <KitTable :columns="columns" :data="filtered" :loading="loading">
        <template #name="{ row }">
          <button class="cell--link border-0 bg-transparent p-0 text-left" @click="openEdit(row)">
            {{ row.name || '未命名记录' }}
          </button>
        </template>
        <template #status="{ row }">
          <span class="chip" :class="row.status === '已确认' || row.status === 'approved' ? 'chip-ok' : 'chip-brand'">
            {{ row.status || '草稿' }}
          </span>
        </template>
        <template #action="{ row }">
          <button class="icon-btn" title="编辑" @click="openEdit(row)">
            <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
          </button>
        </template>
      </KitTable>
      <div class="border-t border-line bg-surface-2 px-4 py-2 text-right text-12px text-ink-soft">
        共 {{ filtered.length }} 条 · 金额合计
        <strong class="ml-1 font-mono text-ink">
          {{ yuan(filtered.reduce((total, row) => total + row.amount, 0)) }}
        </strong>
      </div>
    </div>
  </div>
</template>
