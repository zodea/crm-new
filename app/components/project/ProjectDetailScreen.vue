<script setup lang="ts">
import type { ProjectDetailReadDTO } from '~/lib/project/repository'
import type { StatusTone } from '~/lib/project/status'
import type { Project } from '~/stores/project'
import type { DataOriginDTO, ProblemDTO } from '~/types/read-model'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { PROJECT_STATUS_TONE } from '~/lib/project/status'

const props = withDefaults(defineProps<{
  projectId: string
  originHint?: DataOriginDTO
  includeDemo?: boolean
}>(), {
  originHint: 'real',
  includeDemo: false,
})

const repository = useNuxtApp().$repositories.projectList
const detail = shallowRef<ProjectDetailReadDTO | null>(null)
const state = shallowRef<'loading' | 'ready' | 'forbidden' | 'not-found' | 'error'>('loading')
const problem = shallowRef<ProblemDTO | null>(null)
const titleRef = useTemplateRef<HTMLHeadingElement>('titleRef')
let latestLoad = 0

const item = computed(() => detail.value?.item ?? null)
const project = computed(() => item.value ? projectFromRead(item.value) : null)
const isDemo = computed(() => item.value?.dataOrigin === 'demo')

useTabTitle(() => item.value?.project.label)

const TONE_CHIP: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  muted: 'chip bg-surface-3 text-ink-faint',
  ok: 'chip-ok',
}
const statusChipClass = computed(() => {
  const tone = item.value ? PROJECT_STATUS_TONE[item.value.status] : undefined
  return tone ? TONE_CHIP[tone] : 'chip-brand'
})

function refLabel(value: ProjectDetailReadDTO['item']['customer']): string {
  return value.state === 'resolved' ? value.label : ''
}

function projectFromRead(value: ProjectDetailReadDTO['item']): Project {
  return {
    id: value.project.id,
    name: value.project.label,
    contractName: value.contractName,
    code: value.code,
    address: value.address,
    region: value.region,
    type: '',
    area: null,
    contractAmount: value.contractAmount == null ? null : Number(value.contractAmount),
    overview: '',
    operationType: value.operationType,
    startDate: value.startDate ?? '',
    plannedEnd: value.plannedEnd ?? '',
    actualEnd: value.actualEnd ?? '',
    plannedDuration: value.plannedDuration,
    status: value.status,
    customerId: value.customer.state === 'resolved' ? value.customer.id : null,
    secondaryCustomerId: value.secondaryCustomer.state === 'resolved'
      ? value.secondaryCustomer.id
      : null,
    developer: refLabel(value.customer),
    developer2: refLabel(value.secondaryCustomer),
    developerSupervisor: '',
    supervisor: '',
    designer: '',
    contractor: value.contractor,
    manager: value.manager,
    managerPhone: '',
    execManager: value.execManager,
    builder: value.builder,
    siteLeader: '',
    siteLeaderPhone: '',
    riskLevel: value.riskLevel,
    approvalStatus: '',
    acceptanceDate: '',
    filingDate: '',
    note: '',
    description: '',
    source: 'central-read',
    createdBy: '',
    createdAt: '',
    updatedBy: '',
    updatedAt: value.updatedAt,
  }
}

async function loadProject() {
  const loadId = ++latestLoad
  state.value = 'loading'
  problem.value = null
  try {
    const result = await repository.get({
      id: props.projectId,
      origin: props.originHint,
      includeDemo: props.includeDemo,
    })
    if (loadId !== latestLoad)
      return
    detail.value = result
    state.value = 'ready'
    await nextTick()
    if (loadId === latestLoad)
      titleRef.value?.focus()
  }
  catch (cause) {
    if (loadId !== latestLoad)
      return
    detail.value = null
    problem.value = projectProblemFromUnknown(cause).problem
    state.value = problem.value.code === 'forbidden'
      ? 'forbidden'
      : problem.value.code === 'not-found' || problem.value.code === 'relationship-mismatch'
        ? 'not-found'
        : 'error'
  }
}

watch(
  () => [props.projectId, props.originHint, props.includeDemo] as const,
  () => void loadProject(),
  { immediate: true },
)
</script>

<template>
  <div
    v-if="state === 'ready' && item && project"
    data-ui="project-detail-screen"
    class="project-detail flex min-w-0 flex-col gap-3"
  >
    <header class="panel min-w-0 overflow-hidden" aria-labelledby="project-detail-title">
      <div class="flex min-w-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
        <span class="i-lucide-file-text h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <div class="min-w-48 flex-[1_1_22rem]">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              id="project-detail-title"
              ref="titleRef"
              tabindex="-1"
              class="m-0 min-w-0 break-words text-17px leading-6 font-800 text-ink outline-none"
            >
              {{ item.project.label }}
            </h2>
            <span class="chip bg-surface-3 text-ink-soft">项目信息</span>
            <span class="chip" :class="statusChipClass">{{ item.status }}</span>
            <span v-if="isDemo" class="chip chip-warn">测试数据</span>
          </div>
          <p class="m-0 mt-0.5 break-words text-11px leading-4 text-ink-soft">
            {{ item.code || '未登记项目编号' }} · {{ item.contractName || item.region || '未登记合同名称' }}
          </p>
        </div>
        <NuxtLink to="/project" class="btn-ghost ml-auto" aria-label="关闭项目详情">
          <span class="i-lucide-x mr-1" aria-hidden="true" />关闭
        </NuxtLink>
      </div>

      <dl class="project-detail__metadata m-0 grid border-t border-line">
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            业务流程阶段
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ item.status || '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            经营类型
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ item.operationType || '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            项目经理
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ item.manager || '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            客户(甲方)
          </dt>
          <dd class="m-0 mt-0.5 break-words text-12px text-ink">
            {{ item.customer.state === 'resolved' ? item.customer.label : '未登记' }}
          </dd>
        </div>
        <div class="project-detail__metadata-cell px-3 py-2">
          <dt class="text-9px text-ink-faint">
            承包单位
          </dt>
          <dd class="m-0 mt-0.5 break-words text-12px text-ink">
            {{ item.contractor || '未登记' }}
          </dd>
        </div>
      </dl>
    </header>

    <section
      data-authoritative-readonly
      :data-demo-readonly="isDemo || undefined"
      class="panel min-w-0 overflow-hidden"
      role="status"
      :aria-label="isDemo ? '测试数据只读详情' : '中央项目只读详情'"
    >
      <div
        v-if="isDemo"
        class="border-b border-warn/30 bg-warn/8 px-3 py-2 text-12px leading-5 text-ink-soft"
      >
        <b class="text-warn">测试数据仅供查看。</b>
        正式新增、编辑、审批、付款、归档和删除入口不会作用于这条记录；修改测试数据需进入独立演示工作区。
      </div>
      <div class="min-w-0 overflow-x-auto p-3">
        <ProjectDetailTab :project="project" />
      </div>
    </section>
  </div>

  <StatePanel
    v-else-if="state === 'loading'"
    kind="loading"
    title="正在从中央后台加载项目详情"
  />
  <StatePanel
    v-else-if="state === 'forbidden'"
    kind="forbidden"
    title="无项目查看权限"
    :description="problem?.message"
  />
  <StatePanel
    v-else-if="state === 'error'"
    kind="error"
    title="项目详情加载失败"
    :description="problem?.message"
    action-label="重新加载"
    @action="loadProject"
  />
  <StatePanel
    v-else
    kind="empty"
    title="项目不存在或当前来源不可见"
    description="请确认测试数据开关与来源后返回项目列表重试。"
  >
    <template #action>
      <NuxtLink to="/project" class="btn-secondary">
        <span class="i-lucide-arrow-left mr-1" aria-hidden="true" />
        返回项目列表
      </NuxtLink>
    </template>
  </StatePanel>
</template>

<style scoped>
.project-detail {
  container: project-detail / inline-size;
}

.project-detail__metadata {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
}

.project-detail__metadata-cell {
  min-width: 0;
  background: transparent;
}

.project-detail__metadata-cell + .project-detail__metadata-cell {
  border-left: 1px solid var(--line);
}
</style>
