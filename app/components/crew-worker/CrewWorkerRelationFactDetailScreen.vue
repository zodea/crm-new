<script setup lang="ts">
import type {
  CrewDetailReadDTO,
  CrewPenaltyDTO,
  CrewWorkerRelationFactIdentityDTO,
  WorkerAssignmentDTO,
  WorkerDetailReadDTO,
  WorkerPenaltyDTO,
  WorkerWageStatementDTO,
} from '~/lib/crew-worker/repository'
import type { DataOriginDTO, ProblemDTO, ReadState } from '~/types/read-model'
import { computed, nextTick, onActivated, shallowRef, watch } from 'vue'
import { crewWorkerProblemFromUnknown } from '~/lib/crew-worker/read-decoder'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readProblemTitle } from '~/lib/read-model/state'

const props = defineProps<{
  factKind: 'assignment' | 'wage' | 'penalty'
  factId: string
  projectId?: string
  ownerKind: 'crew' | 'worker'
  ownerId: string
  origin: DataOriginDTO
  includeDemo: boolean
  returnTo: string
}>()

const store = useCrewWorkerReadStore()
const repository = useNuxtApp().$repositories.crewWorkerRead
const queryKey = computed(() => `${props.factKind}:${props.factId}:${props.projectId ?? ''}:${props.ownerKind}:${props.ownerId}:${props.origin}:${props.includeDemo}`)
const settledKey = shallowRef('')
const identity = shallowRef<CrewWorkerRelationFactIdentityDTO | null>(null)
const identityProblem = shallowRef<ProblemDTO | null>(null)
let generation = 0
bindReadAuthority((problem) => {
  generation++
  identity.value = null
  identityProblem.value = problem
  settledKey.value = queryKey.value
})
const state = computed<ReadState<CrewDetailReadDTO> | ReadState<WorkerDetailReadDTO>>(() => props.ownerKind === 'crew'
  ? store.crewDetailState
  : store.workerDetailState)
const detail = computed(() => {
  if (settledKey.value !== queryKey.value)
    return null
  if (props.ownerKind === 'crew') {
    const value = store.crewDetailState
    if (value.kind !== 'ready' && value.kind !== 'empty')
      return null
    return value.data.crew.id === props.ownerId && value.data.dataOrigin === props.origin ? value.data : null
  }
  const value = store.workerDetailState
  if (value.kind !== 'ready' && value.kind !== 'empty')
    return null
  return value.data.worker.id === props.ownerId && value.data.dataOrigin === props.origin ? value.data : null
})
const workerDetail = computed(() => props.ownerKind === 'worker' ? detail.value as WorkerDetailReadDTO | null : null)
const crewDetail = computed(() => props.ownerKind === 'crew' ? detail.value as CrewDetailReadDTO | null : null)
const assignment = computed<WorkerAssignmentDTO | null>(() => props.factKind === 'assignment'
  ? workerDetail.value?.assignments.find(row => row.unit.id === props.factId
    && row.project.state === 'resolved'
    && row.project.id === props.projectId) ?? null
  : null)
const wage = computed<WorkerWageStatementDTO | null>(() => props.factKind === 'wage'
  ? workerDetail.value?.wageStatements.find(row => row.statement.id === props.factId) ?? null
  : null)
const penalty = computed<CrewPenaltyDTO | WorkerPenaltyDTO | null>(() => {
  if (props.factKind !== 'penalty')
    return null
  return workerDetail.value?.penalties.find(row => row.penalty.id === props.factId)
    ?? crewDetail.value?.penalties.find(row => row.penalty.id === props.factId)
    ?? null
})
const fact = computed(() => assignment.value ?? wage.value ?? penalty.value)
const relationshipMismatch = computed(() => Boolean(identity.value && (
  !identity.value.owners.some(owner => owner.kind === props.ownerKind && owner.id === props.ownerId)
  || (props.factKind === 'assignment' && identity.value.projectId !== props.projectId)
)))
const relationProject = computed(() => assignment.value?.project ?? wage.value?.project ?? penalty.value?.project ?? null)
const relationProjectNavigation = computed(() => assignment.value?.projectNavigation ?? wage.value?.projectNavigation ?? penalty.value?.projectNavigation ?? null)
const ownerName = computed(() => workerDetail.value?.worker.name ?? crewDetail.value?.crew.name ?? '')
const title = computed(() => assignment.value?.unit.label
  ?? wage.value?.statement.label
  ?? penalty.value?.penalty.label
  ?? (props.factKind === 'assignment' ? '责任单元详情' : props.factKind === 'wage' ? '工资单详情' : '扣罚单详情'))
const problem = computed(() => identityProblem.value ?? ('problem' in state.value ? state.value.problem : null))
const shellState = computed(() => {
  if (settledKey.value !== queryKey.value)
    return 'loading' as const
  if (identityProblem.value?.code === 'forbidden' || identityProblem.value?.code === 'unauthenticated')
    return 'forbidden' as const
  if (identityProblem.value?.code === 'not-found')
    return 'not-found' as const
  if (identityProblem.value || relationshipMismatch.value)
    return 'error' as const
  if (state.value.kind === 'idle' || state.value.kind === 'loading')
    return 'loading' as const
  if (state.value.kind === 'forbidden')
    return 'forbidden' as const
  if (state.value.kind === 'error' || state.value.kind === 'unavailable')
    return 'error' as const
  if (relationshipMismatch.value)
    return 'error' as const
  if (state.value.kind === 'not-found' || state.value.kind === 'mismatch' || !fact.value)
    return 'not-found' as const
  return 'ready' as const
})

async function load() {
  const requestedGeneration = ++generation
  const requestedKey = queryKey.value
  settledKey.value = ''
  identity.value = null
  identityProblem.value = null
  try {
    const resolved = await repository.getRelationFactIdentity({
      kind: props.factKind,
      id: props.factId,
      origin: props.origin,
      includeDemo: props.includeDemo,
    })
    if (requestedGeneration !== generation || requestedKey !== queryKey.value)
      return
    identity.value = resolved
    const ownerMatches = resolved.owners.some(owner => owner.kind === props.ownerKind && owner.id === props.ownerId)
    const projectMatches = props.factKind !== 'assignment' || resolved.projectId === props.projectId
    if (!ownerMatches || !projectMatches) {
      settledKey.value = requestedKey
      await focusTitle()
      return
    }
  }
  catch (cause) {
    if (requestedGeneration !== generation || requestedKey !== queryKey.value)
      return
    identityProblem.value = crewWorkerProblemFromUnknown(cause).problem
    settledKey.value = requestedKey
    await focusTitle()
    return
  }
  const query = { id: props.ownerId, origin: props.origin, includeDemo: props.includeDemo }
  if (props.ownerKind === 'crew')
    await store.loadCrewDetail(query)
  else
    await store.loadWorkerDetail(query)
  if (requestedGeneration !== generation || requestedKey !== queryKey.value)
    return
  settledKey.value = requestedKey
  await focusTitle()
}

async function focusTitle() {
  await nextTick()
  document.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
}

watch(queryKey, () => void load(), { immediate: true })
onActivated(() => void load())
</script>

<template>
  <EntityDetailShell
    :title="title"
    :subtitle="ownerName ? `来源：${ownerKind === 'crew' ? '班组' : '工人'}·${ownerName}` : ''"
    :back-to="returnTo"
    back-label="返回来源详情"
    :state="shellState"
    :state-title="readProblemTitle(problem, relationshipMismatch || identityProblem?.code === 'relationship-mismatch' || state.kind === 'mismatch' ? '关系来源不匹配' : shellState === 'not-found' ? '事实不存在或已删除' : shellState === 'error' ? '事实详情加载失败' : '正在加载事实详情')"
    :state-description="relationshipMismatch ? '该事实不属于地址中的来源对象或项目，已拒绝展示。' : problem?.message ?? ''"
    :state-action-label="shellState === 'error' && problem?.retryable ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand">
        {{ factKind === 'assignment' ? '责' : factKind === 'wage' ? '资' : '扣' }}
      </div>
    </template>
    <template #status>
      <span class="chip">{{ origin === 'demo' ? '测试数据·只读' : '正式数据·只读' }}</span>
    </template>
    <template #summary>
      <MetricGrid v-if="assignment" :cols="4">
        <Metric label="楼栋" :value="assignment.buildingName || '—'" />
        <Metric label="楼层" :value="assignment.floorName || '—'" />
        <Metric label="工种" :value="assignment.trade || '—'" />
        <Metric label="已完成阶段" :value="`${assignment.completedStageCount} 项`" />
      </MetricGrid>
      <MetricGrid v-else-if="wage" :cols="4">
        <Metric label="期间" :value="wage.month || '—'" />
        <Metric label="状态" :value="wage.status" />
        <Metric label="本人核算" :value="`¥${wage.workerLineAmount}`" />
        <Metric label="本人已分配" :value="wage.allocationRecorded ? `¥${wage.allocatedAmount}` : '历史未记录'" />
      </MetricGrid>
      <MetricGrid v-else-if="penalty" :cols="4">
        <Metric label="扣罚日期" :value="penalty.penaltyDate || '—'" />
        <Metric label="金额" :value="`¥${penalty.amount}`" />
        <Metric label="状态" :value="penalty.status" />
        <Metric label="位置" :value="penalty.location || '—'" />
      </MetricGrid>
    </template>

    <section v-if="relationProject" class="panel p-4" aria-label="关联项目">
      <SectionHeader title="关联项目" subtitle="按中央稳定项目 ID 展示" />
      <EntityLink
        :id="relationProject.state === 'resolved' ? relationProject.id : null"
        type="project"
        :label="relationProject.state === 'resolved' ? relationProject.label : null"
        :intent="relationProjectNavigation ?? undefined"
        :return-to="returnTo"
      />
    </section>
    <section v-if="assignment" class="panel mt-4 p-4" aria-label="责任单元事实">
      <SectionHeader title="责任范围" :subtitle="assignment.note || '按中央责任关系只读展示'" />
      <div class="flex flex-wrap gap-2">
        <span v-for="scope in assignment.scopes" :key="`${scope.roomName}:${scope.itemName}`" class="chip">{{ scope.roomName }}·{{ scope.itemName }}</span>
        <span v-if="!assignment.scopes.length" class="text-12px text-ink-faint">未记录分项责任</span>
      </div>
    </section>
    <section v-else-if="wage" class="panel mt-4 p-4" aria-label="工资单事实">
      <SectionHeader title="单据金额" subtitle="个人分配缺失时不反推整单金额" />
      <dl class="grid gap-3 text-12px sm:grid-cols-2">
        <div>
          <dt class="text-ink-faint">
            整单核算
          </dt><dd class="mt-1 font-mono text-ink">
            ¥{{ wage.statementGrossAmount }}
          </dd>
        </div>
        <div>
          <dt class="text-ink-faint">
            整单实发
          </dt><dd class="mt-1 font-mono text-ink">
            {{ wage.statementActualAmount == null ? '未记录' : `¥${wage.statementActualAmount}` }}
          </dd>
        </div>
      </dl>
    </section>
    <section v-else-if="penalty" class="panel mt-4 p-4" aria-label="扣罚单事实">
      <SectionHeader title="扣罚原因" :subtitle="penalty.source === 'project' ? '项目扣罚' : '合同扣罚'" />
      <p class="m-0 text-13px leading-6 text-ink">
        {{ penalty.reason || '未记录' }}
      </p>
    </section>
  </EntityDetailShell>
</template>
