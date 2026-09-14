<script setup lang="ts">
import type { PayrollSourceKind } from '~/lib/payroll/a-navigation'
import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'
import { usePayrollRead } from '~/composables/usePayrollRead'
import { payrollSourceContext } from '~/lib/payroll/a-navigation'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { usePayrollAFeesStore } from '~/stores/payroll-a-fees'

const props = defineProps<{ kind: PayrollSourceKind, sourceId: string, origin: DataOriginDTO, projectId?: string }>()
const route = useRoute()
const store = usePayrollStore()
const present = computed(() => route.query.payrollReturnTo != null)
const context = computed(() => payrollSourceContext(route.query, { kind: props.kind, id: props.sourceId, origin: props.origin, projectId: props.projectId }))
const { current, error, loading } = usePayrollRead(() => JSON.stringify([context.value, props.kind, props.sourceId, props.origin]), async () => {
  const value = context.value
  if (!value)
    throw new Error('工资返回来源与当前资料不一致，请从原工资重新进入。')
  if (value.configScope) {
    const read = await usePayrollAFeesStore().loadConfig({ origin: props.origin }, value.configScope)
    const responsibility = read.responsibilityOptions
    const matches = props.kind === 'quantity-project' ? value.id === read.scope.projectId : props.kind === 'quantity-unit' ? read.cellOptions.some(cell => cell.unitId === value.id) || responsibility.some(row => row.cells.some(cell => cell.unitId === value.id)) : props.kind === 'crew' ? read.scope.crewId === value.id || responsibility.some(row => row.crewId === value.id) : read.scope.leaderWorkerId === value.id || responsibility.some(row => row.workerId === value.id) || read.managementBooks.some(row => row.book.managerWorkerId === value.id && row.book.id === value.configScope?.book.managementBookId)
    if (read.context.origin !== props.origin || read.scope.projectId !== value.projectId || !matches)
      throw new Error('费用配置与当前来源的稳定关系未通过核对。')
    return { context: read.context, source: value }
  }
  if (value.statementId) {
    const read = await store.loadAForm({ origin: props.origin }, { statementId: value.statementId })
    const fees = hasPayrollAFeesForm(read) && read.bookProof.state === 'proven' ? read.fees : null
    const facts = [...read.facts, ...(fees?.lines.flatMap(line => line.components.map(component => component.fact)) ?? [])]
    const managedUnit = fees?.management?.revision.scope.assignments.some(assignment => assignment.cells.some(cell => cell.unitId === value.id))
    const diagnosticUnit = read.blockers.some(({ source }) => source && (source.kind === 'entity-detail' || source.kind === 'entity-subview' || source.kind === 'source-record') && source.subject.state === 'resolved' && source.subject.entity === 'quantity-unit' && source.subject.id === value.id && source.filters.projectId === value.projectId && source.filters.dataOrigin === props.origin)
    const matches = read.draft.projectId === value.projectId && (props.kind === 'quantity-project' ? value.id === value.projectId : props.kind === 'quantity-unit' ? diagnosticUnit || managedUnit || facts.some(fact => fact.unitId === value.id) : props.kind === 'crew' ? read.draft.crewId === value.id || facts.some(fact => fact.crewId === value.id) : read.draft.memberWorkerIds?.includes(value.id) || facts.some(fact => fact.workerId === value.id))
    if (read.statementId !== value.statementId || read.context.origin !== props.origin || !matches)
      throw new Error('这份工资与当前来源的稳定关系未通过核对，不能返回为同一来源。')
    return { context: read.context, source: value }
  }
  else {
    if (!value.draftKey)
      throw new Error('原新建草稿身份无效。')
    const catalog = await store.loadAForm({ origin: props.origin }, { statementId: null, draftKey: value.draftKey, draft: { projectId: value.projectId } })
    if (catalog.context.origin !== props.origin || catalog.statementId !== null || catalog.draftKey !== value.draftKey || !catalog.options.projects.some(project => project.id === value.projectId))
      throw new Error('原新建草稿的项目当前不可读取，请回工资台账核对。')
    return { context: catalog.context, source: value }
  }
})
</script>

<template>
  <section v-if="present" class="panel flex min-w-0 flex-wrap items-center justify-between gap-3 border-brand/20 bg-brand-soft p-3 text-12px" aria-label="工资原来源返回">
    <div class="min-w-0 flex-1">
      <p class="font-700">
        来自 A 工资的实际来源核对
      </p><p v-if="loading" role="status">
        正在核对原工资与当前来源…
      </p><p v-else-if="error" role="alert" class="mt-1 break-words text-danger">
        {{ error }}
      </p><p v-else class="mt-1 leading-5 text-ink-soft">
        返回后保留原输入。来源修改须重新核对，不会自动执行工资命令。
      </p>
    </div>
    <NuxtLink v-if="current && !error && !loading" :to="current.source.returnTo" class="btn-primary">
      返回原工资
    </NuxtLink>
  </section>
</template>
