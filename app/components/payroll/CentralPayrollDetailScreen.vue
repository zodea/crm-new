<script setup lang="ts">
import { computed } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollReadLocation, payrollReadQuery, payrollReturnTo, payrollViewQuery, payrollViewScope } from '~/lib/payroll/central-navigation'
import { payrollAmount, payrollNumber, payrollStatusLabel } from '~/lib/payroll/read-presentation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

const route = useRoute()
const store = usePayrollStatementDetailStore()
const visibility = useDataVisibilityStore()
const scope = computed(() => payrollViewScope(route.query))
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const { current, loading, error, load } = usePayrollRead(() => JSON.stringify([id.value, scope.value, visibility.includeDemo]), async () => {
  const requestedId = id.value
  const scopeQuery = payrollReadQuery(scope.value, visibility.includeDemo)
  const query = { origin: scopeQuery.origin, includeDemo: scopeQuery.includeDemo }
  if (!isStableRouteIdentity(requestedId))
    throw new Error('工资记录身份无效，请从台账重新打开。')
  const read = await store.loadRead(query, requestedId)
  if (read.statement.id !== requestedId || read.context.origin !== query.origin)
    throw new Error('工资记录与来源不一致，不能改用其他记录。')
  return read
})
const statement = computed(() => current.value?.statement)
const back = computed(() => payrollReturnTo(route.query.returnTo, scope.value.origin) || payrollReadLocation('/subcontract/payroll', scope.value))
const sources = computed(() => {
  if (!statement.value)
    return null
  return { path: '/subcontract/payroll/sources', query: { ...payrollViewQuery({ ...scope.value, projectId: statement.value.projectId, month: statement.value.month, crewId: statement.value.crewId || '' }), returnTo: payrollReadLocation(`/subcontract/payroll/${encodeURIComponent(statement.value.id)}`, scope.value) } }
})
const lineColumns = [{ field: 'workerName', title: '姓名', width: 140 }, { field: 'itemName', title: '分项', width: 180 }, { field: 'unit', title: '单位', width: 90 }, { field: 'quantity', title: '数量' }, { field: 'unitPrice', title: '单价', money: true }, { field: 'amount', title: '金额', money: true }, { field: 'deletedAt', title: '记录状态' }]
const memberColumns = [{ field: 'workerName', title: '成员姓名', width: 160 }, { field: 'isLeader', title: '角色' }, { field: 'deletedAt', title: '记录状态' }]
const allocationColumns = [{ field: 'workerName', title: '收款成员', width: 160 }, { field: 'isLeader', title: '角色' }, { field: 'amount', title: '分配金额', money: true }, { field: 'deletedAt', title: '记录状态' }]
const dayworkColumns = [{ field: 'workerName', title: '姓名' }, { field: 'workDate', title: '签工日期' }, { field: 'workContent', title: '工作内容', width: 240 }, { field: 'laborUnits', title: '工数' }, { field: 'status', title: '签工确认状态' }, { field: 'deletedAt', title: '记录状态' }]
const originalHeader = computed(() => statement.value ? JSON.stringify(statement.value.stored.head, null, 2) : '')
const originalFields = computed(() => {
  const head = statement.value?.stored.head
  const value = (key: string, money = false) => head?.[key] == null ? '未记录' : money && typeof head[key] === 'number' ? payrollAmount(head[key]) : String(head[key])
  return { month: value('month'), status: typeof head?.status === 'string' ? payrollStatusLabel(head.status) : '未记录', actual: value('actual_amount', true), gross: value('gross_amount', true) }
})
useTabTitle(computed(() => statement.value ? `${statement.value.month} · 工资历史` : '工资历史'))
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-20px font-800">
          工资历史详情
        </h1><p class="mt-1 text-12px text-ink-faint">
          {{ statement?.projectName || '项目名称未记录' }} · {{ statement?.month || '月份未记录' }}
        </p>
      </div><div class="flex flex-wrap gap-2">
        <NuxtLink :to="back" class="btn-secondary">
          返回工资台账
        </NuxtLink><NuxtLink v-if="sources" :to="sources" class="btn-secondary">
          查看本月来源
        </NuxtLink><KitButton :disabled="loading" @click="load">
          刷新
        </KitButton>
      </div>
    </header>
    <PayrollReadNotice />
    <p v-if="loading" role="status" class="text-12px text-ink-faint">
      正在读取原工资记录…
    </p>
    <section v-if="error" class="panel p-4 text-danger" role="alert">
      {{ error }}
    </section>
    <template v-if="statement && !error">
      <section v-if="statement.recordKind === 'isolated' || statement.formatFamily === 'B'" class="panel border-warn/30 bg-warn-soft p-4 text-13px leading-6" aria-label="隔离工资历史">
        这份记录为{{ statement.formatFamily === 'B' ? '已退役的 B 格式' : '待核对的隔离历史' }}，仅保留原始资料供核对，不生成新的工资表或发放结果。
      </section>
      <section class="panel grid min-w-0 grid-cols-2 gap-4 p-4 text-12px md:grid-cols-4" aria-label="工资金额与状态">
        <div>
          <span class="text-ink-faint">负责人</span><p class="mt-1 break-words font-700">
            {{ statement.leaderName || '姓名未记录' }}
          </p>
        </div><div>
          <span class="text-ink-faint">班组</span><p class="mt-1 break-words">
            {{ statement.crewName || '班组未记录' }}
          </p>
        </div>
        <div>
          <span class="text-ink-faint">格式 / 工资状态</span><p class="mt-1">
            {{ statement.formatFamily }} · {{ payrollStatusLabel(statement.status) }}
          </p>
        </div><div>
          <span class="text-ink-faint">记录状态</span><p class="mt-1">
            {{ statement.deletedAt ? '已删除历史' : '保留中' }}{{ statement.needsRecheck ? ' · 待重新核对' : '' }}
          </p>
        </div>
        <div>
          <span class="text-ink-faint">核算应发</span><p class="mt-1 font-mono font-700">
            {{ payrollAmount(statement.grossAmount) }}
          </p>
        </div><div>
          <span class="text-ink-faint">实际发放</span><p class="mt-1 font-mono font-700">
            {{ payrollAmount(statement.actualAmount) }}
          </p>
        </div>
        <div>
          <span class="text-ink-faint">此前已发</span><p class="mt-1 font-mono">
            {{ payrollAmount(statement.previouslyPaid) }}
          </p>
        </div><div>
          <span class="text-ink-faint">保存比例</span><p class="mt-1">
            {{ statement.payRatio === null ? '未记录' : `${payrollNumber(statement.payRatio * 100)}%` }}
          </p>
        </div>
        <p v-if="statement.note" class="col-span-full break-words leading-5 text-ink-soft">
          备注：{{ statement.note }}
        </p>
      </section>
      <PayrollReadDiagnostics :issues="statement.diagnostics" />
      <PayrollSnapshotEvidence :snapshot="statement.snapshot" />
      <PayrollEvidenceTable title="工资明细" :rows="statement.lines" :columns="lineColumns" />
      <PayrollEvidenceTable title="请款成员" :rows="statement.members" :columns="memberColumns" />
      <PayrollEvidenceTable title="收款分配" :rows="statement.allocations" :columns="allocationColumns" empty="原发放资料未提供可读取的成员分配，不推定全部付给负责人。" />
      <PayrollEvidenceTable title="关联签工" :rows="statement.daywork" :columns="dayworkColumns" />
      <details class="panel min-w-0 p-4 text-12px" aria-label="原关系历史">
        <summary class="cursor-pointer font-700">
          查看原表与关系历史
        </summary><p class="my-3 leading-5 text-ink-soft">
          以下是保存的原表记录，包含删除历史。它们不用于补齐上方缺失的发放结果。
        </p>
        <dl class="mb-4 grid grid-cols-2 gap-3 text-12px md:grid-cols-4" aria-label="原工资头业务记录">
          <div>
            <dt class="text-ink-faint">
              原记录月份
            </dt><dd class="mt-1">
              {{ originalFields.month }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              原工资状态
            </dt><dd class="mt-1">
              {{ originalFields.status }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              原记录实际金额
            </dt><dd class="mt-1 font-mono">
              {{ originalFields.actual }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              原记录应发金额
            </dt><dd class="mt-1 font-mono">
              {{ originalFields.gross }}
            </dd>
          </div>
        </dl>
        <details class="mb-3">
          <summary class="cursor-pointer">
            查看工资头原始记录
          </summary><pre tabindex="0" class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all bg-surface-3 p-3">{{ originalHeader }}</pre>
        </details>
        <div class="grid min-w-0 gap-3">
          <PayrollEvidenceTable title="保存的明细历史" :rows="statement.stored.lines" :columns="lineColumns" /><PayrollEvidenceTable title="保存的成员历史" :rows="statement.stored.members" :columns="memberColumns" /><PayrollEvidenceTable title="保存的分配历史" :rows="statement.stored.allocations" :columns="allocationColumns" /><PayrollEvidenceTable title="保存的签工关联历史" :rows="statement.stored.dayworkLinks" :columns="[{ field: 'dayworkRecordId', title: '原签工身份', width: 260 }, { field: 'deletedAt', title: '记录状态' }]" />
        </div>
      </details>
      <PayrollReadHistory :history="current!.history" />
      <PayrollSourceEvidence :evidence="current!.evidence" />
    </template>
  </main>
</template>
