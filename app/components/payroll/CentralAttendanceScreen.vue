<script setup lang="ts">
import { computed, watch } from 'vue'
import CentralAttendanceGrid from '~/components/payroll/CentralAttendanceGrid.vue'
import PayrollAttendanceCellDialog from '~/components/payroll/PayrollAttendanceCellDialog.vue'
import PayrollC1SourceReturn from '~/components/payroll/PayrollC1SourceReturn.vue'
import PayrollSourceEvidence from '~/components/payroll/PayrollSourceEvidence.vue'
import { useCentralAttendance } from '~/composables/useCentralAttendance'
import { payrollReadLocation, payrollViewQuery } from '~/lib/payroll/central-navigation'

const route = useRoute()
const router = useRouter()
const ui = useCentralAttendance()
const { current, loading, error, scope, selected, worker, records, working, commandError, pending, pendingCells, readonlyReasons, active } = ui
const createTo = computed(() => ({ path: '/subcontract/payroll/new', query: { ...payrollViewQuery(scope.value), format: 'C1', returnTo: payrollReadLocation('/subcontract/attendance', scope.value) } }))
const sourceRecord = computed(() => typeof route.query.record === 'string' ? route.query.record : '')
const sourceValid = computed(() => !sourceRecord.value || current.value?.records.some(record => record.id === sourceRecord.value && record.workerId === route.query.worker && record.workDate === route.query.workDate))
watch(() => [current.value, sourceRecord.value, route.query.worker, route.query.workDate], () => {
  const record = current.value?.records.find(record => record.id === sourceRecord.value && record.workerId === route.query.worker && record.workDate === route.query.workDate)
  if (record && !selected.value)
    ui.select(record.workerId, record.workDate)
}, { flush: 'post' })
function change(field: 'project' | 'month' | 'crew', value: string) {
  void router.replace({ path: '/subcontract/attendance', query: { ...route.query, [field]: value || undefined, ...(field === 'project' ? { crew: undefined } : {}) } })
}
</script>

<template>
  <main class="grid min-w-0 gap-4" data-ui="central-attendance-screen">
    <header class="panel flex flex-wrap items-start justify-between gap-3 p-4">
      <div>
        <h1 class="text-20px font-800">
          考勤管理
        </h1><p class="mt-1 text-12px text-ink-soft">
          逐日正常工时、加班与施工内容。工资按每人有效标准核算。
        </p>
      </div><div class="flex flex-wrap gap-2">
        <NuxtLink :to="ui.back.value" class="btn-secondary">
          返回工资台账
        </NuxtLink><NuxtLink v-if="current && !current.context.readonly && current.context.capabilities.includes('payroll:write')" :to="createTo" class="btn-primary">
          新建 C1 工资
        </NuxtLink>
      </div>
    </header>
    <section class="panel grid gap-3 p-4 sm:grid-cols-3" aria-label="考勤筛选">
      <label class="grid min-w-0 gap-1 text-12px">项目<select :value="scope.projectId" class="field-input min-w-0" aria-label="考勤项目" :disabled="working" @change="change('project', ($event.target as HTMLSelectElement).value)"><option value="">请选择项目</option><option v-for="project in current?.options.projects || []" :key="project.id" :value="project.id">{{ project.name || '名称未记录' }}</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px">月份<input :value="scope.month" class="field-input min-w-0" aria-label="考勤月份" type="month" :disabled="working" @change="change('month', ($event.target as HTMLInputElement).value)"></label>
      <label class="grid min-w-0 gap-1 text-12px">班组<select :value="scope.crewId" class="field-input min-w-0" aria-label="考勤班组" :disabled="working" @change="change('crew', ($event.target as HTMLSelectElement).value)"><option value="">全部班组</option><option v-for="crew in current?.options.crews || []" :key="crew.id" :value="crew.id">{{ crew.name || '班组未记录' }}</option></select></label>
    </section>
    <p v-if="loading" role="status">
      正在读取当前范围…
    </p><section v-if="error" class="panel p-4 text-danger" role="alert">
      {{ error }}<KitButton class="ml-3" @click="ui.load">
        重新读取
      </KitButton>
    </section>
    <template v-if="current && !error">
      <PayrollC1SourceReturn v-if="route.query.payrollFormat === 'C1' && sourceRecord && scope.origin" kind="attendance" :source-id="sourceRecord" :project-id="typeof route.query.payrollProject === 'string' ? route.query.payrollProject : scope.projectId" :origin="scope.origin" />
      <p v-if="sourceRecord && !sourceValid" class="panel p-3 text-12px text-warn">
        当前矩阵范围不包含指定原考勤，未改用其他日期或工人。可按原工资入口返回核对。
      </p>
      <p v-if="current.context.readonly" class="panel p-4 text-13px">
        当前来源仅供查看，不提供考勤登记或工资发放。
      </p>
      <section v-for="cell in pendingCells" :key="cell.operation.command.commandId" class="panel p-3 text-12px text-warn">
        {{ cell.name }} · {{ cell.date }} {{ cell.operation.state === 'awaiting-read' ? '提交已保存，等待读取原结果。' : '有待核对提交。' }}<KitButton @click="ui.select(cell.workerId, cell.date)">
          打开原提交
        </KitButton>
      </section>
      <p v-if="!current.scope.projectId || !current.scope.month" class="panel p-4 text-13px">
        请选择项目和月份后查看日期矩阵。
      </p>
      <CentralAttendanceGrid v-else-if="current.workers.length" :month="current.scope.month" :workers="current.workers" :records="current.records" :locks="current.locks" :busy="loading || working" @select="ui.select" />
      <p v-else class="panel p-4 text-13px">
        当前范围没有可读取的考勤人员。请核对工人的项目资格与所选班组。
      </p>
      <section v-if="current.diagnostics.length" class="panel grid gap-2 p-4 text-12px" aria-label="考勤资料核对">
        <h2 class="font-700">
          原资料需核对
        </h2><p v-for="(issue, index) in current.diagnostics" :key="index">
          {{ issue.message }}<span v-if="issue.workerId"> · 原工人：{{ issue.workerId }}</span>
        </p>
      </section>
      <PayrollSourceEvidence :evidence="current.evidence" />
    </template>
    <PayrollAttendanceCellDialog v-if="selected && worker" :open="active" :worker="worker" :work-date="selected.workDate" :records="records" :initial="ui.cellDraft.value" :busy="working" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :original="pending?.command.action.record" :error="commandError" :readonly-reasons="readonlyReasons" @update:open="!$event && ui.discard()" @change="ui.keepInput" @save="ui.save" @recover="ui.recover" />
  </main>
</template>
