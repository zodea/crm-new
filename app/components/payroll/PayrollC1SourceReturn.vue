<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollC1SourceContext } from '~/lib/payroll/c1-navigation'

const props = defineProps<{ kind: 'attendance' | 'worker' | 'crew', sourceId: string, origin: DataOriginDTO, projectId?: string }>()
const route = useRoute()
const store = usePayrollC1Store()
const attendance = useAttendanceCentralStore()
const context = computed(() => payrollC1SourceContext(route.query, { kind: props.kind, id: props.sourceId, origin: props.origin, projectId: props.projectId }))
const { current, error, loading } = usePayrollRead(() => JSON.stringify([context.value, props.origin, route.query.worker, route.query.workDate, route.query.record]), async () => {
  const target = context.value
  if (!target)
    throw new Error('原 C1 工资与当前来源身份不一致。')
  const read = await store.loadC1Form({ origin: props.origin }, target.statementId ? { statementId: target.statementId } : { statementId: null, draftKey: target.draftKey!, draft: { projectId: target.projectId } })
  if (read.context.origin !== props.origin || read.statementId !== target.statementId || (!target.statementId && read.draftKey !== target.draftKey) || read.draft.projectId !== target.projectId)
    throw new Error('原工资与来源项目不一致，不能替换目标。')
  let related = props.kind === 'attendance' ? read.facts.some(fact => fact.id === props.sourceId) : props.kind === 'worker' ? read.members.some(member => member.id === props.sourceId) || read.options.workers.some(worker => worker.id === props.sourceId) : read.draft.crewId === props.sourceId || read.options.crews.some(crew => crew.id === props.sourceId)
  if (!target.statementId && props.kind === 'attendance' && read.options.projects.some(project => project.id === target.projectId)) {
    const original = new URL(target.returnTo, 'https://payroll.invalid')
    const month = original.searchParams.get('month') || ''
    const crewId = original.searchParams.get('crew') || null
    const matrix = await attendance.loadMatrix({ origin: props.origin }, { projectId: target.projectId, month, crewId })
    related = matrix.context.workspaceId === read.context.workspaceId && matrix.context.actorId === read.context.actorId && matrix.context.origin === props.origin && matrix.scope.projectId === target.projectId && matrix.scope.month === month && matrix.scope.crewId === crewId && route.query.record === props.sourceId && matrix.records.some(record => record.id === props.sourceId && record.workerId === route.query.worker && record.workDate === route.query.workDate)
  }
  if (!related)
    throw new Error('原工资未证明与此来源相关，请从原工资重新打开。')
  return { context: read.context, returnTo: target.returnTo }
})
</script>

<template>
  <section class="panel flex min-w-0 flex-wrap items-start justify-between gap-3 border-brand/20 bg-brand-soft p-3 text-12px" aria-label="C1工资原来源返回">
    <div class="min-w-0">
      <p class="font-700">
        来自 C1 工资的考勤与标准核对
      </p><p v-if="loading" role="status" class="mt-1">
        正在核对原工资…
      </p><p v-else-if="error" role="alert" class="mt-1 break-words text-danger">
        {{ error }}
      </p><p v-else class="mt-1">
        返回原工资保留输入；来源修改后需明确重新核对考勤。
      </p>
    </div><NuxtLink v-if="current && !loading && !error" :to="current.returnTo" class="btn-primary">
      返回原工资
    </NuxtLink>
  </section>
</template>
