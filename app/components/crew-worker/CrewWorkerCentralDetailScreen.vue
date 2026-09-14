<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import { computed, nextTick, onActivated, shallowRef, watch } from 'vue'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
import { useCrewWorkerReadStore } from '~/stores/crew-worker-read'

const props = defineProps<{ kind: 'crew' | 'worker', id: string, origin: DataOriginDTO, includeDemo: boolean, returnTo?: string }>()
const route = useRoute()
const store = useCrewWorkerReadStore()
const queryKey = computed(() => `${props.kind}:${props.origin}:${props.id}:${props.includeDemo}`)
const settledKey = shallowRef('')
const state = computed(() => props.kind === 'crew' ? store.crewDetailState : store.workerDetailState)
const crewDetail = computed(() => {
  if (props.kind !== 'crew' || settledKey.value !== queryKey.value)
    return null
  const value = store.crewDetailState
  if ((value.kind === 'ready' || value.kind === 'partial' || value.kind === 'empty')
    && value.data.crew.id === props.id && value.data.dataOrigin === props.origin) {
    return value.data
  }
  return null
})
const workerDetail = computed(() => {
  if (props.kind !== 'worker' || settledKey.value !== queryKey.value)
    return null
  const value = store.workerDetailState
  if ((value.kind === 'ready' || value.kind === 'partial' || value.kind === 'empty')
    && value.data.worker.id === props.id && value.data.dataOrigin === props.origin) {
    return value.data
  }
  return null
})
const detail = computed(() => props.kind === 'crew' ? crewDetail.value : workerDetail.value)
const problem = computed(() => 'problem' in state.value ? state.value.problem : null)
const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
  if (settledKey.value !== queryKey.value)
    return 'loading'
  if (detail.value)
    return 'ready'
  if (state.value.kind === 'idle' || state.value.kind === 'loading')
    return 'loading'
  if (state.value.kind === 'forbidden')
    return 'forbidden'
  if (state.value.kind === 'not-found' || state.value.kind === 'mismatch')
    return 'not-found'
  return 'error'
})
const title = computed(() => props.kind === 'crew' ? crewDetail.value?.crew.name : workerDetail.value?.worker.name)
const subtitle = computed(() => props.kind === 'crew'
  ? [crewDetail.value?.crew.trade, crewDetail.value?.crew.contactName, crewDetail.value?.crew.contactPhone].filter(Boolean).join(' · ')
  : [workerDetail.value?.worker.trade, workerDetail.value?.worker.phone, workerDetail.value?.worker.projectStatus].filter(Boolean).join(' · '))
const canEdit = computed(() => detail.value?.dataOrigin === 'real' && detail.value.capabilities.includes(`${props.kind}:write`))
const canManageMembers = computed(() => crewDetail.value?.dataOrigin === 'real' && crewDetail.value.capabilities.includes('worker:write'))
const editTo = computed(() => {
  const query = new URLSearchParams({ origin: 'real' })
  const returnTo = validateCrewWorkerReturnTo(props.returnTo)
  if (returnTo)
    query.set('returnTo', returnTo)
  return `/base/${props.kind}/form/${encodeURIComponent(props.id)}?${query.toString()}`
})
const penaltyReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(props.returnTo, props.origin, 'project_penalty'))
const backTo = computed(() => penaltyReturnTo.value ?? validateCrewWorkerReturnTo(props.returnTo) ?? `/base/${props.kind}`)
useTabTitle(() => title.value)

async function load() {
  const requestedKey = queryKey.value
  settledKey.value = ''
  if (props.kind === 'crew')
    await store.loadCrewDetail({ id: props.id, origin: props.origin, includeDemo: props.includeDemo })
  else await store.loadWorkerDetail({ id: props.id, origin: props.origin, includeDemo: props.includeDemo })
  if (requestedKey !== queryKey.value)
    return
  settledKey.value = requestedKey
  await nextTick()
  document.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
}
watch(queryKey, () => void load(), { immediate: true })
onActivated(() => void load())
</script>

<template>
  <EntityDetailShell
    :title="title ?? (kind === 'crew' ? '班组详情' : '工人详情')"
    :subtitle="subtitle"
    :back-to="backTo"
    :back-label="penaltyReturnTo ? '返回项目罚扣' : `返回${kind === 'crew' ? '班组' : '工人'}列表`"
    :state="shellState"
    :state-title="shellState === 'not-found' ? `${kind === 'crew' ? '班组' : '工人'}不存在或来源不匹配` : shellState === 'forbidden' ? '无权查看该档案' : shellState === 'loading' ? '正在加载中央详情' : '中央详情加载失败'"
    :state-description="problem?.message ?? ''"
    :state-action-label="problem?.retryable ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div v-if="title" class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand">
        {{ title.slice(0, 1) }}
      </div>
    </template>
    <template #status>
      <span v-if="detail" class="chip">{{ detail.dataOrigin === 'demo' ? '测试数据' : '正式数据' }}</span>
    </template>
    <template #actions>
      <NuxtLink v-if="canEdit" :to="editTo" class="btn-primary">
        <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑
      </NuxtLink>
      <span v-else-if="detail?.dataOrigin === 'demo'" class="text-11px text-ink-faint">测试档案只读</span>
    </template>
    <template #summary>
      <PayrollC1SourceReturn v-if="detail && route.query.payrollReturnTo && route.query.payrollFormat === 'C1'" :kind="kind" :source-id="id" :origin="origin" class="mb-4" />
      <PayrollC2SourceReturn v-else-if="detail && route.query.payrollReturnTo && route.query.payrollFormat === 'C2'" :kind="kind" :source-id="id" :origin="origin" class="mb-4" />
      <PayrollASourceReturn v-else-if="detail && route.query.payrollReturnTo" :kind="kind" :source-id="id" :origin="origin" class="mb-4" />
      <MetricGrid v-if="crewDetail && kind === 'crew'" :cols="6" data-testid="crew-central-summary">
        <Metric label="成员" :value="`${crewDetail.summary.memberCount} 人`" /><Metric label="在场成员" :value="`${crewDetail.summary.activeMemberCount} 人`" /><Metric label="关联项目" :value="`${crewDetail.summary.projectCount} 个`" /><Metric label="责任单元" :value="`${crewDetail.summary.assignedUnitCount} 个`" /><Metric label="已发工资" :value="`¥${crewDetail.summary.releasedWageAmount}`" /><Metric label="扣罚" :value="`¥${crewDetail.summary.penaltyAmount}`" />
      </MetricGrid>
      <MetricGrid v-else-if="workerDetail" :cols="6" data-testid="worker-central-summary">
        <Metric label="关联项目" :value="`${workerDetail.summary.projectCount} 个`" /><Metric label="责任单元" :value="`${workerDetail.summary.assignedUnitCount} 个`" /><Metric label="完成阶段" :value="`${workerDetail.summary.completedStageCount} 个`" /><Metric label="工资分配" :value="`¥${workerDetail.summary.knownAllocatedAmount}`" /><Metric label="分配待记录" :value="`${workerDetail.summary.missingAllocationCount} 条`" /><Metric label="扣罚" :value="`¥${workerDetail.summary.penaltyAmount}`" />
      </MetricGrid>
    </template>

    <div v-if="crewDetail && kind === 'crew'" class="grid min-w-0 gap-4" data-ui="crew-central-detail">
      <section class="panel p-4">
        <SectionHeader title="班组主档" subtitle="负责人、计价能力和统一分配规则" /><dl class="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-11px text-ink-faint">
              负责人
            </dt><dd class="mt-1 text-13px">
              {{ crewDetail.crew.contactName || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              联系电话
            </dt><dd class="mt-1 text-13px">
              {{ crewDetail.crew.contactPhone || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              能力工种
            </dt><dd class="mt-1 text-13px">
              {{ crewDetail.crew.tradeCapabilities.join('、') || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              默认工资比例
            </dt><dd class="mt-1 text-13px">
              {{ Math.round(crewDetail.crew.defaultPayRatio * 100) }}%
            </dd>
          </div>
        </dl>
      </section>
      <CrewMemberSection :detail="crewDetail" :can-manage="canManageMembers" :return-to="route.fullPath" @changed="load" />
      <section class="panel min-w-0 overflow-hidden">
        <SectionHeader class="p-4 pb-2" title="项目与工资事实" subtitle="在场成员、工程量责任和工资单按项目稳定 ID 聚合" /><div class="max-w-full overflow-x-auto">
          <table class="w-full min-w-860px text-left text-12px">
            <thead class="bg-surface-2 text-ink-soft">
              <tr>
                <th class="p-3">
                  项目
                </th><th class="p-3">
                  事实来源
                </th><th class="p-3">
                  在场
                </th><th class="p-3">
                  责任单元
                </th><th class="p-3">
                  工资单
                </th><th class="p-3">
                  已发工资
                </th>
              </tr>
            </thead><tbody>
              <tr v-for="row in crewDetail.projects" :key="row.project.state === 'resolved' ? row.project.id : row.project.label ?? 'missing'" class="border-t border-line">
                <td class="p-3">
                  <EntityLink :id="row.project.state === 'resolved' ? row.project.id : null" type="project" :label="row.project.state === 'resolved' ? row.project.label : null" :intent="row.navigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  {{ row.sources.join('、') }}
                </td><td class="p-3">
                  {{ row.activeMemberCount }}
                </td><td class="p-3">
                  {{ row.assignedUnitCount }}
                </td><td class="p-3">
                  {{ row.wageStatementCount }}
                </td><td class="p-3">
                  ¥{{ row.releasedWageAmount }}
                </td>
              </tr><tr v-if="!crewDetail.projects.length">
                <td colspan="6" class="p-6 text-center text-ink-faint">
                  暂无项目、责任或工资事实
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel min-w-0 overflow-hidden">
        <SectionHeader class="p-4 pb-2" title="扣罚事实" subtitle="只显示有稳定单据 ID 的扣罚记录" /><div class="max-w-full overflow-x-auto">
          <table class="w-full min-w-760px text-left text-12px">
            <thead class="bg-surface-2 text-ink-soft">
              <tr>
                <th class="p-3">
                  单号
                </th><th class="p-3">
                  项目
                </th><th class="p-3">
                  位置
                </th><th class="p-3">
                  原因
                </th><th class="p-3">
                  金额
                </th><th class="p-3">
                  状态
                </th>
              </tr>
            </thead><tbody>
              <tr v-for="row in crewDetail.penalties" :key="row.penalty.id" class="border-t border-line">
                <td class="p-3">
                  <EntityLink :id="row.penalty.id" type="subcontract-document" :label="row.penalty.label" :intent="row.navigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  <EntityLink :id="row.project.state === 'resolved' ? row.project.id : null" type="project" :label="row.project.state === 'resolved' ? row.project.label : null" :intent="row.projectNavigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  {{ row.location || '—' }}
                </td><td class="p-3">
                  {{ row.reason || '—' }}
                </td><td class="p-3">
                  ¥{{ row.amount }}
                </td><td class="p-3">
                  {{ row.status }}
                </td>
              </tr><tr v-if="!crewDetail.penalties.length">
                <td colspan="6" class="p-6 text-center text-ink-faint">
                  暂无扣罚事实
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div v-else-if="workerDetail" class="grid min-w-0 gap-4" data-ui="worker-central-detail">
      <section class="panel p-4">
        <SectionHeader title="工人主档" subtitle="敏感字段按权限脱敏，关联只认稳定 ID" /><dl class="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-11px text-ink-faint">
              所属班组
            </dt><dd class="mt-1 text-13px">
              <EntityLink v-if="workerDetail.crew" :id="workerDetail.crew.crew.id" type="crew" :label="workerDetail.crew.crew.label" :intent="workerDetail.crew.navigation" :return-to="route.fullPath" /><span v-else>—</span>
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              联系电话
            </dt><dd class="mt-1 text-13px">
              {{ workerDetail.worker.phone || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              身份证号
            </dt><dd class="mt-1 text-13px">
              {{ workerDetail.worker.idCard || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              银行卡号
            </dt><dd class="mt-1 text-13px">
              {{ workerDetail.worker.bankAccount || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              能力工种
            </dt><dd class="mt-1 text-13px">
              {{ workerDetail.capabilitiesDetail.trades.join('、') || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              安全教育
            </dt><dd class="mt-1 text-13px">
              {{ workerDetail.worker.safetyEducation ? '已完成' : '未记录' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              进场日期
            </dt><dd class="mt-1 text-13px">
              {{ workerDetail.worker.entryDate || '—' }}
            </dd>
          </div><div>
            <dt class="text-11px text-ink-faint">
              日工资
            </dt><dd class="mt-1 text-13px">
              {{ workerDetail.worker.dailyWage == null ? '历史未记录' : `¥${workerDetail.worker.dailyWage}` }}
            </dd>
          </div>
        </dl>
      </section>
      <section v-if="workerDetail.relatedWorkers.length" class="panel p-4">
        <SectionHeader title="关联人员" subtitle="家庭关系与历史关联分别标识" /><div class="mt-3 flex flex-wrap gap-2">
          <span v-for="row in workerDetail.relatedWorkers" :key="row.worker.id" class="chip"><EntityLink :id="row.worker.id" type="worker" :label="row.worker.label" :intent="row.navigation" :return-to="route.fullPath" /> · {{ row.source === 'family' ? '家庭关系' : '历史关联' }}</span>
        </div>
      </section>
      <section class="panel min-w-0 overflow-hidden">
        <SectionHeader class="p-4 pb-2" title="项目与责任单元" subtitle="工程量责任按项目 ID + 单元 ID 精确穿透" /><div class="max-w-full overflow-x-auto">
          <table class="w-full min-w-900px text-left text-12px">
            <thead class="bg-surface-2 text-ink-soft">
              <tr>
                <th class="p-3">
                  责任单元
                </th><th class="p-3">
                  项目
                </th><th class="p-3">
                  楼栋/楼层
                </th><th class="p-3">
                  工种
                </th><th class="p-3">
                  责任范围
                </th><th class="p-3">
                  完成阶段
                </th>
              </tr>
            </thead><tbody>
              <tr v-for="row in workerDetail.assignments" :key="row.id" class="border-t border-line">
                <td class="p-3">
                  <EntityLink :id="row.unit.id" type="quantity-unit" :label="row.unit.label" :intent="row.navigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  <EntityLink :id="row.project.state === 'resolved' ? row.project.id : null" type="project" :label="row.project.state === 'resolved' ? row.project.label : null" :intent="row.projectNavigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  {{ [row.buildingName, row.floorName].filter(Boolean).join(' / ') || '—' }}
                </td><td class="p-3">
                  {{ row.trade || '—' }}
                </td><td class="p-3">
                  {{ row.scopes.map(scope => `${scope.roomName}·${scope.itemName}`).join('、') || '—' }}
                </td><td class="p-3">
                  {{ row.completedStageCount }}
                </td>
              </tr><tr v-if="!workerDetail.assignments.length">
                <td colspan="6" class="p-6 text-center text-ink-faint">
                  暂无工程量责任
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel min-w-0 overflow-hidden">
        <SectionHeader class="p-4 pb-2" title="工资事实" subtitle="未记录分配金额时保持未知，不以工价反推" /><div class="max-w-full overflow-x-auto">
          <table class="w-full min-w-820px text-left text-12px">
            <thead class="bg-surface-2 text-ink-soft">
              <tr>
                <th class="p-3">
                  工资单
                </th><th class="p-3">
                  项目
                </th><th class="p-3">
                  月份
                </th><th class="p-3">
                  工人行金额
                </th><th class="p-3">
                  已分配
                </th><th class="p-3">
                  状态
                </th>
              </tr>
            </thead><tbody>
              <tr v-for="row in workerDetail.wageStatements" :key="row.statement.id" class="border-t border-line">
                <td class="p-3">
                  <EntityLink :id="row.statement.id" type="wage-statement" :label="row.statement.label" :intent="row.navigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  <EntityLink :id="row.project.state === 'resolved' ? row.project.id : null" type="project" :label="row.project.state === 'resolved' ? row.project.label : null" :intent="row.projectNavigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  {{ row.month || '—' }}
                </td><td class="p-3">
                  ¥{{ row.workerLineAmount }}
                </td><td class="p-3">
                  {{ row.allocationRecorded ? `¥${row.allocatedAmount}` : '历史未记录' }}
                </td><td class="p-3">
                  {{ row.status }}
                </td>
              </tr><tr v-if="!workerDetail.wageStatements.length">
                <td colspan="6" class="p-6 text-center text-ink-faint">
                  暂无工资事实
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel min-w-0 overflow-hidden">
        <SectionHeader class="p-4 pb-2" title="扣罚事实" subtitle="工人本人或责任人命中的中央扣罚记录" /><div class="max-w-full overflow-x-auto">
          <table class="w-full min-w-760px text-left text-12px">
            <thead class="bg-surface-2 text-ink-soft">
              <tr>
                <th class="p-3">
                  单号
                </th><th class="p-3">
                  项目
                </th><th class="p-3">
                  位置
                </th><th class="p-3">
                  原因
                </th><th class="p-3">
                  金额
                </th><th class="p-3">
                  状态
                </th>
              </tr>
            </thead><tbody>
              <tr v-for="row in workerDetail.penalties" :key="row.penalty.id" class="border-t border-line">
                <td class="p-3">
                  <EntityLink :id="row.penalty.id" type="subcontract-document" :label="row.penalty.label" :intent="row.navigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  <EntityLink :id="row.project.state === 'resolved' ? row.project.id : null" type="project" :label="row.project.state === 'resolved' ? row.project.label : null" :intent="row.projectNavigation" :return-to="route.fullPath" />
                </td><td class="p-3">
                  {{ row.location || '—' }}
                </td><td class="p-3">
                  {{ row.reason || '—' }}
                </td><td class="p-3">
                  ¥{{ row.amount }}
                </td><td class="p-3">
                  {{ row.status }}
                </td>
              </tr><tr v-if="!workerDetail.penalties.length">
                <td colspan="6" class="p-6 text-center text-ink-faint">
                  暂无扣罚事实
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </EntityDetailShell>
</template>
