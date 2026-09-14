<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { PayrollStatementRow } from '~/lib/payroll/central-contract'
import type { PayrollViewScope } from '~/lib/payroll/central-navigation'
import { computed } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollReadLocation, payrollReadQuery, payrollStatusSelection, payrollViewQuery, payrollViewScope } from '~/lib/payroll/central-navigation'
import { payrollStatementTarget } from '~/lib/payroll/central-target'
import { payrollAmount, payrollSnapshotLabel, payrollStatusLabel, payrollStatusTone } from '~/lib/payroll/read-presentation'

const route = useRoute()
const router = useRouter()
const store = usePayrollStore()
const visibility = useDataVisibilityStore()
const scope = computed(() => payrollViewScope(route.query))
const query = computed(() => payrollReadQuery({ ...scope.value, crewId: '' }, visibility.includeDemo))
const { current, loading, error, load } = usePayrollRead(() => JSON.stringify([scope.value, visibility.includeDemo]), () => store.loadRead(query.value))
const rows = computed(() => (current.value?.rows || []).filter((row) => {
  const filter = scope.value
  const statuses = payrollStatusSelection(filter.status)
  return (!statuses.length || statuses.includes(row.status)) && (!filter.crewId || row.crewId === filter.crewId) && (!filter.format || row.formatFamily === filter.format)
    && (!filter.deleted || !!row.deletedAt === (filter.deleted === 'deleted'))
    && (!filter.search.trim() || [row.projectName, row.crewName, row.leaderName, row.month].some(value => value?.includes(filter.search.trim())))
}))
const crews = computed(() => [...new Map((current.value?.rows || []).flatMap(row => row.crewId ? [[row.crewId, { id: row.crewId, name: row.crewName || '班组名称未记录' }] as const] : [])).values()])
const returnTo = computed(() => payrollReadLocation('/subcontract/payroll', scope.value))
const sources = computed(() => payrollReadLocation('/subcontract/payroll/sources', scope.value))
const canCreate = computed(() => scope.value.origin === 'real' && current.value?.context.capabilities.includes('payroll:write'))
const createTo = computed(() => ({ path: '/subcontract/payroll/new', query: { ...payrollViewQuery(scope.value), origin: 'real', format: undefined, returnTo: returnTo.value } }))
const createC1To = computed(() => ({ path: '/subcontract/payroll/new', query: { ...payrollViewQuery(scope.value), origin: 'real', format: 'C1', returnTo: returnTo.value } }))
const createC2To = computed(() => ({ path: '/subcontract/payroll/new', query: { ...payrollViewQuery(scope.value), origin: 'real', format: 'C2', returnTo: returnTo.value } }))
const attendanceTo = computed(() => payrollReadLocation('/subcontract/attendance', scope.value))
const configTo = computed(() => ({ path: '/subcontract/payroll/config', query: { origin: 'real', project: scope.value.projectId, month: scope.value.month, crew: scope.value.crewId, returnTo: returnTo.value } }))
const columns: KitTableColumn[] = [
  { field: 'month', title: '月份 / 详情', minWidth: 142, fixed: 'left', slot: 'detail' },
  { field: 'projectName', title: '项目', minWidth: 210 },
  { field: 'leaderName', title: '负责人', minWidth: 130, slot: 'leader' },
  { field: 'crewName', title: '班组', minWidth: 150, slot: 'crew' },
  { field: 'formatFamily', title: '格式 / 请款簿', minWidth: 165, slot: 'format' },
  { field: 'status', title: '工资状态', width: 120, slot: 'status' },
  { field: 'grossAmount', title: '核算应发', width: 145, align: 'right', slot: 'gross' },
  { field: 'actualAmount', title: '实际发放', width: 145, align: 'right', slot: 'actual' },
  { field: 'snapshot', title: '发放记录', minWidth: 165, slot: 'snapshot' },
  { field: 'recordKind', title: '记录范围', minWidth: 170, slot: 'record' },
]
function change(patch: Partial<PayrollViewScope>) {
  void router.replace({ path: '/subcontract/payroll', query: payrollViewQuery({ ...scope.value, ...patch }) })
}
function detail(row: PayrollStatementRow) {
  return payrollStatementTarget(row, scope.value, returnTo.value)
}
useTabTitle('工资台账')
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-20px font-800">
          工资台账
        </h1><p class="mt-1 text-12px text-ink-faint">
          按原项目、月份与班组查询工资和已保留的发放记录。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <NuxtLink :to="{ path: '/subcontract/payroll/payments', query: { origin: scope.origin || 'real', project: scope.projectId, returnTo } }" class="btn-secondary">
          工资实际收付
        </NuxtLink>
        <NuxtLink v-if="canCreate" :to="createTo" class="btn-primary">
          新建 A 工资草稿
        </NuxtLink>
        <NuxtLink v-if="canCreate" :to="createC1To" class="btn-primary">
          新建 C1 工资草稿
        </NuxtLink><NuxtLink v-if="canCreate" :to="createC2To" class="btn-primary">
          新建 C2 工资草稿
        </NuxtLink>
        <NuxtLink :to="attendanceTo" class="btn-secondary">
          考勤管理
        </NuxtLink>
        <NuxtLink v-if="canCreate" :to="configTo" class="btn-secondary">
          工资配置
        </NuxtLink>
        <NuxtLink :to="sources" class="btn-secondary">
          查看工资来源
        </NuxtLink><KitButton :disabled="loading" @click="load">
          刷新
        </KitButton>
      </div>
    </header>
    <PayrollReadNotice />
    <label class="flex flex-wrap items-center gap-2 text-12px">资料来源<select class="field-input max-w-full" :value="scope.origin || ''" @change="change({ origin: ($event.target as HTMLSelectElement).value === 'demo' ? 'demo' : 'real', projectId: '', crewId: '' })"><option value="real">正式工资</option><option value="demo">演示工资（只读）</option></select></label>
    <PayrollReadFilters :scope="scope" :projects="current?.projects || []" :crews="crews" @change="change" />
    <section v-if="error" role="alert" class="panel p-4 text-13px text-danger">
      {{ error }}<p class="mt-2 text-ink-soft">
        当前来源未成功读取，可重新核对；不会改用其他项目或本机资料。
      </p>
    </section>
    <template v-else>
      <PayrollReadDiagnostics :issues="current?.diagnostics || []" />
      <section class="panel min-w-0 overflow-hidden" aria-label="工资只读台账">
        <KitTable :columns="columns" :data="rows" :loading="loading" :min-rows="6" :row-height="48" :empty="{ title: '当前筛选下没有工资记录', description: '没有工资单的项目也可在工资来源中查询配置、考勤和签工。' }">
          <template #detail="{ row }">
            <NuxtLink v-if="detail(row)" :to="detail(row)!" class="cell--link">
              {{ row.month || '月份未记录' }}
            </NuxtLink><span v-else>{{ row.month || '月份未记录' }}</span>
          </template>
          <template #leader="{ row }">
            {{ row.leaderName || '姓名未记录' }}
          </template><template #crew="{ row }">
            {{ row.crewName || '班组未记录' }}
          </template>
          <template #status="{ row }">
            <KitStatusTag :tone="payrollStatusTone(row.status)">
              {{ payrollStatusLabel(row.status) }}
            </KitStatusTag>
          </template>
          <template #format="{ row }">
            {{ row.formatFamily }}<span v-if="row.book" class="block text-11px text-ink-soft">{{ row.book.bookPurpose === 'management' ? '独立管理费簿' : '普通施工簿' }}</span>
          </template>
          <template #gross="{ row }">
            {{ payrollAmount(row.grossAmount) }}
          </template><template #actual="{ row }">
            {{ payrollAmount(row.actualAmount) }}
          </template>
          <template #snapshot="{ row }">
            {{ payrollSnapshotLabel(row.snapshot.state) }}
          </template>
          <template #record="{ row }">
            {{ row.recordKind === 'isolated' ? '隔离历史 · 只读' : row.deletedAt ? '已删除历史' : '当前记录' }}
          </template>
        </KitTable>
      </section>
      <p role="status" class="text-12px text-ink-faint">
        当前 {{ rows.length }} 份记录 · {{ rows.filter(row => row.status === 'released').length }} 份已发放 · {{ rows.filter(row => row.recordKind === 'isolated').length }} 份隔离历史。未记录的金额保留为空。
      </p>
    </template>
  </main>
</template>
