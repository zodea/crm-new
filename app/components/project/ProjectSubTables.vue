<script setup lang="ts">
// Tab③ 施工合同 / Tab④ 支出合同 两张子表已接合同域真数据（contracts store，#90）：
// 合同名蓝链 → /contract/[id]、乙方蓝链 → /base/supplier/[id]，与三列表/合同详情互跳。
// 其余子表仍为空壳（各域 pass-1 逐步接入）。
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  tab: string
  projectId: string
}>()

interface SubTable {
  title: string
  /** 接合同域真数据的子表：con=施工合同（kind=施工），exp=支出合同（kind=分包/材采） */
  contracts?: 'con' | 'exp'
  columns: { field: string, title: string, width?: string, minWidth?: string }[]
}

const TAB_TABLES: Record<string, SubTable[]> = {
  budget: [
    {
      title: '目标成本',
      columns: [
        { field: 'name', title: '目标成本名称', minWidth: '200px' },
        { field: 'taxIncTotal', title: '含税合价', width: '120px' },
        { field: 'signedAmount', title: '已签合同金额', width: '120px' },
        { field: 'actualAmount', title: '实际发生金额', width: '120px' },
        { field: 'appliedAmount', title: '已申请付金额', width: '120px' },
      ],
    },
  ],
  construction: [
    {
      title: '施工合同',
      contracts: 'con',
      columns: [],
    },
    {
      title: '补充协议',
      columns: [
        { field: 'name', title: '协议名称', minWidth: '200px' },
        { field: 'amount', title: '金额', width: '120px' },
        { field: 'signDate', title: '签约日期', width: '100px' },
      ],
    },
    {
      title: '甲方变洽签',
      columns: [
        { field: 'changeNo', title: '变更编号', width: '120px' },
        { field: 'contractName', title: '合同名称', minWidth: '160px' },
        { field: 'taxIncAmount', title: '含税审定金额', width: '130px' },
        { field: 'approvalDate', title: '审定日期', width: '100px' },
      ],
    },
  ],
  expenditure: [
    {
      title: '支出合同',
      contracts: 'exp',
      columns: [],
    },
  ],
  tax: [
    {
      title: '开票申请',
      columns: [
        { field: 'name', title: '开票申请名称', minWidth: '200px' },
        { field: 'amount', title: '开票金额', width: '120px' },
        { field: 'status', title: '审核状态', width: '90px' },
        { field: 'invoiceDate', title: '开票日期', width: '100px' },
      ],
    },
    {
      title: '收票登记',
      columns: [
        { field: 'invoiceNo', title: '发票号码', width: '160px' },
        { field: 'amount', title: '发票金额', width: '120px' },
        { field: 'taxAmount', title: '税额', width: '100px' },
        { field: 'invoiceType', title: '发票类型', width: '130px' },
        { field: 'invoiceDate', title: '开票日期', width: '100px' },
      ],
    },
  ],
  fund: [
    {
      title: '收款登记',
      columns: [
        { field: 'receiptNo', title: '收款编号', width: '140px' },
        { field: 'receiptDate', title: '收款日期', width: '100px' },
        { field: 'amount', title: '收款金额', width: '120px' },
        { field: 'paymentMethod', title: '支付方式', width: '90px' },
        { field: 'payerUnit', title: '支付单位', minWidth: '150px' },
      ],
    },
    {
      title: '付款申请',
      columns: [
        { field: 'applicationNo', title: '付款编号', width: '140px' },
        { field: 'approvalStatus', title: '审批状态', width: '90px' },
        { field: 'amount', title: '申请金额', width: '120px' },
        { field: 'paidAmount', title: '已付金额', width: '120px' },
        { field: 'actualPayment', title: '实际支付', width: '120px' },
      ],
    },
  ],
  current: [
    {
      title: '往来收款',
      columns: [
        { field: 'receiptNo', title: '编号', width: '140px' },
        { field: 'receiptDate', title: '收款日期', width: '100px' },
        { field: 'amount', title: '收款金额', width: '120px' },
        { field: 'payer', title: '付款人', minWidth: '150px' },
      ],
    },
    {
      title: '往来付款',
      columns: [
        { field: 'paymentNo', title: '编号', width: '140px' },
        { field: 'paymentDate', title: '付款日期', width: '100px' },
        { field: 'amount', title: '金额', width: '120px' },
        { field: 'payee', title: '收款单位', minWidth: '150px' },
      ],
    },
  ],
  payment: [
    {
      title: '支付记录',
      columns: [
        { field: 'paymentNo', title: '支付编号', width: '140px' },
        { field: 'paymentDate', title: '支付日期', width: '100px' },
        { field: 'amount', title: '支付金额', width: '120px' },
        { field: 'paymentMethod', title: '支付方式', width: '90px' },
        { field: 'payeeAccount', title: '收款账户', minWidth: '150px' },
      ],
    },
  ],
  material: [
    {
      title: '入库单',
      columns: [
        { field: 'no', title: '单据编号', width: '140px' },
        { field: 'type', title: '类型', width: '80px' },
        { field: 'supplier', title: '分供方', minWidth: '150px' },
        { field: 'date', title: '入库日期', width: '100px' },
      ],
    },
  ],
  acceptance: [
    {
      title: '竣工验收',
      columns: [
        { field: 'no', title: '验收编号', width: '140px' },
        { field: 'contractName', title: '合同名称', minWidth: '200px' },
        { field: 'status', title: '验收状态', width: '90px' },
        { field: 'estimatedAmount', title: '合同估价', width: '120px' },
      ],
    },
    {
      title: '保修到期确认单',
      columns: [
        { field: 'no', title: '编号', width: '140px' },
        { field: 'contractName', title: '合同名称', minWidth: '200px' },
        { field: 'approvalStatus', title: '审批状态', width: '90px' },
        { field: 'responsible', title: '保修负责人', width: '100px' },
      ],
    },
  ],
}

const subTables = computed(() => TAB_TABLES[props.tab] || [])

// ── 合同域真数据（③施工/④支出）：contracts store 按 kind + projectId 切片 ──
const contractStore = useContractStore()
const supplierStore = useSupplierStore()

const conRows = computed(() =>
  contractStore.byKind('施工').filter(c => c.projectId === props.projectId),
)
const expRows = computed(() =>
  [...contractStore.byKind('分包'), ...contractStore.byKind('材采')]
    .filter(c => c.projectId === props.projectId),
)

function rowsFor(key: 'con' | 'exp') {
  return key === 'con' ? conRows.value : expRows.value
}

function supplierName(id: string | null): string {
  return id ? supplierStore.byId(id)?.name ?? '—' : '—'
}

// vxe formatter：稳定引用（内联新函数/新对象会反复触发 vxe 列注册）
const moneyFmt = ({ cellValue }: { cellValue: unknown }) => yuan(cellValue as number)

onMounted(() => {
  contractStore.load()
  supplierStore.load()
})
</script>

<template>
  <div class="space-y-4">
    <div v-for="st in subTables" :key="st.title">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-13px font-700 text-ink">
          {{ st.title }}({{ st.contracts ? rowsFor(st.contracts).length : 0 }})
        </h4>
        <button class="btn-primary text-12px" disabled>
          <span class="i-lucide-plus text-12px mr-0.5" /> 新建
        </button>
      </div>
      <div class="border border-line">
        <!-- 合同域子表（③施工/④支出）：真数据 + 合同名/乙方蓝链 -->
        <vxe-table
          v-if="st.contracts"
          :data="rowsFor(st.contracts)"
          :loading="contractStore.loading"
          border
          show-overflow="title"
          height="auto"
          :row-config="{ isHover: true, keyField: 'id' }"
        >
          <vxe-column type="seq" title="#" width="52" />
          <vxe-column field="name" title="合同名称" min-width="200">
            <template #default="{ row }">
              <NuxtLink :to="`/contract/${row.id}`" class="cell--link">
                {{ row.name }}
              </NuxtLink>
            </template>
          </vxe-column>
          <vxe-column field="no" title="合同编号" width="170" />
          <vxe-column v-if="st.contracts === 'exp'" field="kind" title="类别" width="80">
            <template #default="{ row }">
              {{ row.kind === '分包' ? `分包${row.subKind ? ` · ${row.subKind}` : ''}` : '材采' }}
            </template>
          </vxe-column>
          <vxe-column
            v-if="st.contracts === 'exp'"
            field="supplierId"
            title="乙方（分供方）"
            min-width="170"
          >
            <template #default="{ row }">
              <NuxtLink v-if="row.supplierId" :to="`/base/supplier/${row.supplierId}`" class="cell--link">
                {{ supplierName(row.supplierId) }}
              </NuxtLink>
              <span v-else>—</span>
            </template>
          </vxe-column>
          <vxe-column
            field="amount"
            :title="st.contracts === 'exp' ? '含税合价' : '含税合同金额'"
            width="130"
            align="right"
            class-name="col--money"
            :formatter="moneyFmt"
          />
          <vxe-column field="status" title="合同状态" width="90" />
          <vxe-column field="signDate" title="签约日期" width="100" />
        </vxe-table>

        <!-- 其余子表：空壳占位 -->
        <vxe-table
          v-else
          :data="[]"
          border
          show-overflow
          height="auto"
          :row-config="{ isHover: true }"
        >
          <vxe-column type="seq" title="#" width="52" />
          <vxe-column
            v-for="col in st.columns"
            :key="col.field"
            :field="col.field"
            :title="col.title"
            :width="col.width"
            :min-width="col.minWidth"
          />
        </vxe-table>
      </div>
    </div>

    <div v-if="!subTables.length" class="border border-line bg-panel p-8 text-center text-ink-faint text-13px">
      此 Tab 暂无子表定义
    </div>
  </div>
</template>
