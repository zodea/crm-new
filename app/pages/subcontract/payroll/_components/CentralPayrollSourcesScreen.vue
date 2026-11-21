<script setup lang="ts">
import type { PayrollSourcesRead } from '~/lib/payroll/central-contract'
import type { PayrollViewScope } from '~/lib/payroll/central-navigation'
import { computed } from 'vue'
import PayrollEvidenceTable from '~/components/payroll/PayrollEvidenceTable.vue'
import PayrollReadDiagnostics from '~/components/payroll/PayrollReadDiagnostics.vue'
import PayrollReadFilters from '~/components/payroll/PayrollReadFilters.vue'
import PayrollReadHistory from '~/components/payroll/PayrollReadHistory.vue'
import PayrollReadNotice from '~/components/payroll/PayrollReadNotice.vue'
import PayrollSourceEvidence from '~/components/payroll/PayrollSourceEvidence.vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollReadQuery, payrollReturnTo, payrollSourceReturnTo, payrollViewQuery, payrollViewScope } from '~/lib/payroll/central-navigation'

const props = withDefaults(defineProps<{ initialTab?: string }>(), { initialTab: 'configs' })
const route = useRoute()
const router = useRouter()
const store = usePayrollStore()
const attendance = useAttendanceStore()
const daywork = useSignedDayworkStore()
const visibility = useDataVisibilityStore()
const scope = computed(() => payrollViewScope(route.query))
const tabs = [{ key: 'configs', title: '工资配置' }, { key: 'attendance', title: '考勤记录' }, { key: 'daywork', title: '签工记录' }, { key: 'locks', title: '月份与签工占用' }]
const selectedTab = computed(() => tabs.some(tab => tab.key === scope.value.tab) ? scope.value.tab : props.initialTab)
const { current, loading, error, load } = usePayrollRead(() => JSON.stringify([scope.value, props.initialTab, visibility.includeDemo]), async () => {
  const query = payrollReadQuery(scope.value, visibility.includeDemo)
  const list = await store.loadRead({ origin: query.origin, includeDemo: query.includeDemo })
  let sources: PayrollSourcesRead | null = null
  let crews: { id: string, name: string }[] = []
  if (query.projectId) {
    const sourceQuery = { ...query, projectId: query.projectId }
    const readSources = props.initialTab === 'daywork' ? daywork.loadRead : attendance.loadRead
    const catalog = await readSources({ ...sourceQuery, crewId: undefined })
    const heads = list.rows.filter(row => row.projectId === query.projectId && (!query.month || row.month === query.month))
    const crewIds = [...new Set([...catalog.configs, ...catalog.attendance, ...catalog.daywork, ...heads].flatMap(row => row.crewId ? [row.crewId] : []))]
    crews = crewIds.map(id => ({ id, name: heads.find(row => row.crewId === id)?.crewName || `班组名称未记录 · ${id}` }))
    sources = query.crewId ? await readSources(sourceQuery) : catalog
    if (sources.projectId !== query.projectId || sources.context.origin !== query.origin)
      throw new Error('来源项目与当前选择不一致，请重新打开。')
  }
  return { context: list.context, projects: list.projects, sources, crews }
})
const sources = computed(() => current.value?.sources)
const back = computed(() => payrollSourceReturnTo(route.query.returnTo, scope.value))
const crews = computed(() => current.value?.crews || [])
const show = (row: { deletedAt: string | null }) => !scope.value.deleted || !!row.deletedAt === (scope.value.deleted === 'deleted')
const configs = computed(() => sources.value?.configs.filter(show) || [])
const attendanceRows = computed(() => sources.value?.attendance.filter(show) || [])
const dayworkRows = computed(() => sources.value?.daywork.filter(row => show(row) && (!scope.value.dayworkStatus || row.status === scope.value.dayworkStatus)) || [])
const locks = computed(() => sources.value?.locks.map((lock, index) => ({ ...lock, id: `lock-${index}`, meaning: lock.kind === 'released-month' ? '当月已有发放记录' : lock.kind === 'format-exclusion' ? '当月工资格式已被占用' : '签工已被工资单领用', dayworkRecordId: lock.dayworkRecordId })) || [])
function change(patch: Partial<PayrollViewScope>) {
  void router.replace({ path: route.path, query: { ...payrollViewQuery({ ...scope.value, ...patch }), ...(payrollReturnTo(route.query.returnTo, scope.value.origin) ? { returnTo: back.value } : {}) } })
}
useTabTitle('工资来源')
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-20px font-800">
          工资来源
        </h1><p class="mt-1 text-12px text-ink-faint">
          工资配置、考勤与签工可独立查询，无须先建立工资单。
        </p>
      </div><div class="flex flex-wrap gap-2">
        <NuxtLink :to="back" class="btn-secondary">
          返回工资记录
        </NuxtLink><KitButton :disabled="loading" @click="load">
          刷新
        </KitButton>
      </div>
    </header>
    <PayrollReadNotice />
    <PayrollReadFilters source :scope="scope" :projects="current?.projects || []" :crews="crews" @change="change" />
    <section v-if="error" role="alert" class="panel p-4 text-danger">
      {{ error }}
    </section>
    <p v-if="loading" role="status" class="text-12px text-ink-faint">
      正在读取工资来源…
    </p>
    <section v-if="!scope.projectId && !error" class="panel p-5 text-13px leading-6 text-ink-soft">
      请选择项目查看独立来源。没有工资单的项目仍可查询已经保存的配置、考勤和签工。
    </section>
    <template v-if="sources && !error">
      <PayrollReadDiagnostics :issues="sources.diagnostics" />
      <nav class="flex min-w-0 flex-wrap gap-2" aria-label="工资来源视图">
        <KitButton v-for="tab in tabs" :key="tab.key" :variant="selectedTab === tab.key ? 'primary' : 'secondary'" :aria-pressed="selectedTab === tab.key" @click="change({ tab: tab.key })">
          {{ tab.title }}
        </KitButton>
      </nav>
      <PayrollEvidenceTable v-if="selectedTab === 'configs'" title="工资配置" :rows="configs" :columns="[{ field: 'formatFamily', title: '工资格式' }, { field: 'enabled', title: '启用状态' }, { field: 'updatedAt', title: '最近修改' }, { field: 'unitRate', title: '费率', money: true }, { field: 'ruleText', title: '确认规则', width: 320 }, { field: 'deletedAt', title: '记录状态' }]" />
      <PayrollEvidenceTable v-if="selectedTab === 'attendance'" title="独立考勤记录" :rows="attendanceRows" :columns="[{ field: 'workerName', title: '姓名' }, { field: 'workDate', title: '日期' }, { field: 'hours', title: '正常工时' }, { field: 'overtimeHours', title: '加班工时' }, { field: 'workContent', title: '工作内容', width: 260 }, { field: 'note', title: '备注', width: 220 }, { field: 'deletedAt', title: '记录状态' }]" />
      <PayrollEvidenceTable v-if="selectedTab === 'daywork'" title="独立签工记录" :rows="dayworkRows" :columns="[{ field: 'workerName', title: '姓名' }, { field: 'workDate', title: '日期' }, { field: 'startTime', title: '开始' }, { field: 'endTime', title: '结束' }, { field: 'laborUnits', title: '工数' }, { field: 'status', title: '签工确认状态' }, { field: 'workContent', title: '工作内容', width: 260 }, { field: 'witness', title: '证明人' }, { field: 'confirmedOn', title: '确认日期' }, { field: 'deletedAt', title: '记录状态' }]" />
      <section v-if="selectedTab === 'locks'" class="grid min-w-0 gap-3">
        <p class="text-12px leading-5 text-ink-soft">
          零金额成员、没有工资明细的成员仍可能占用月份；签工确认状态与工资单发放状态分别记录。
        </p><PayrollEvidenceTable title="已保存的月份与签工占用" :rows="locks" :columns="[{ field: 'month', title: '月份' }, { field: 'formatFamily', title: '工资格式' }, { field: 'meaning', title: '占用说明', width: 240 }, { field: 'workerId', title: '成员原身份', width: 270 }, { field: 'statementId', title: '关联工资身份', width: 270 }, { field: 'dayworkRecordId', title: '关联签工身份', width: 270 }]" />
      </section>
      <details class="panel min-w-0 p-4 text-12px">
        <summary class="cursor-pointer">
          查看来源记录身份
        </summary><p class="mt-2 leading-5 text-ink-soft">
          配置与占用资料没有保存历史姓名时，不以当前名册补写。
        </p><pre tabindex="0" class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify({ configs: sources.configs.map(row => ({ id: row.id, crewId: row.crewId, leaderWorkerId: row.leaderWorkerId })) }, null, 2) }}</pre>
      </details>
      <PayrollReadHistory :history="sources.history" />
      <PayrollSourceEvidence :evidence="sources.evidence" />
    </template>
  </main>
</template>
