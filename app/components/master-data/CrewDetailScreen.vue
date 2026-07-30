<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { maskPhone } from '~/lib/util/privacy'

const props = defineProps<{
  crewId: string
}>()

const store = useCrewDetailStore()
const detail = computed(() => store.byCrew(props.crewId))
const crew = computed(() => detail.value?.crew ?? null)
const settledCrewId = shallowRef('')
const loadingCrewId = shallowRef('')
const loadError = shallowRef('')
let latestLoadRequest = 0

useTabTitle(() => crew.value?.name)

const statusLabel = computed(() => {
  switch (crew.value?.status) {
    case 'submitted': return '已提交'
    case 'draft': return '草稿'
    default: return crew.value?.status || '未登记'
  }
})
const statusClass = computed(() =>
  crew.value?.status === 'submitted' ? 'chip-ok' : 'chip-warn',
)
const shellState = computed(() => {
  if (detail.value)
    return 'ready'
  if (loadingCrewId.value === props.crewId || settledCrewId.value !== props.crewId)
    return 'loading'
  if (loadError.value)
    return 'error'
  return 'not-found'
})
const shellStateTitle = computed(() => {
  if (shellState.value === 'loading')
    return '正在加载班组详情'
  if (shellState.value === 'not-found')
    return '班组不存在或已删除'
  return '班组详情加载失败'
})
const shellStateDescription = computed(() =>
  shellState.value === 'not-found'
    ? '该班组可能已被删除，可返回列表查看。'
    : loadError.value,
)

async function loadCrew() {
  const id = props.crewId
  const request = ++latestLoadRequest
  loadError.value = ''
  loadingCrewId.value = id
  try {
    await store.load(id)
  }
  catch (cause) {
    if (request !== latestLoadRequest)
      return
    loadError.value = `班组详情加载失败：${toErrorMessage(cause)}`
  }
  finally {
    if (request === latestLoadRequest) {
      settledCrewId.value = id
      loadingCrewId.value = ''
    }
  }
}

watch(() => props.crewId, () => void loadCrew(), { immediate: true })
</script>

<template>
  <EntityDetailShell
    :title="crew?.name ?? '班组详情'"
    :subtitle="crew
      ? `${crew.trade || '未登记工种'} · ${crew.assignmentLevel === 'worker' ? '可下钻到组内工人' : '班组责任'}`
      : ''"
    back-to="/base/crew"
    back-label="返回班组列表"
    :state="shellState"
    :state-title="shellStateTitle"
    :state-description="shellStateDescription"
    :state-action-label="shellState === 'error' ? '重新加载' : ''"
    @state-action="loadCrew"
  >
    <template #mark>
      <div
        v-if="crew"
        class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand"
      >
        {{ crew.name.slice(0, 1) }}
      </div>
    </template>

    <template #status>
      <span v-if="crew" :class="statusClass">
        {{ statusLabel }}
      </span>
    </template>

    <template #actions>
      <NuxtLink
        v-if="crew"
        :to="`/base/crew/form/${crew.id}`"
        class="btn-primary"
        aria-label="编辑班组"
      >
        <span class="i-lucide-square-pen mr-1" aria-hidden="true" />
        编辑
      </NuxtLink>
    </template>

    <template #summary>
      <MetricGrid v-if="crew && detail" :cols="5" data-testid="crew-summary">
        <Metric label="工种类型" :value="crew.trade || '—'" />
        <Metric label="负责人" :value="crew.contactName || '—'" />
        <Metric label="联系电话" :value="maskPhone(crew.contactPhone) || '—'" />
        <Metric label="工人数" :value="`${detail.summary.memberCount} 人`" />
        <Metric label="关联项目数" :value="`${detail.summary.projectCount} 个`" />
      </MetricGrid>
    </template>

    <div v-if="crew && detail" class="flex min-w-0 flex-col gap-4">
      <CrewDetailCapabilities :crew="crew" />
      <CrewDetailMembers :members="detail.members" />
      <CrewDetailProjects :projects="detail.projects" />
      <CrewDetailPenalties :penalties="detail.penalties" />
    </div>
  </EntityDetailShell>
</template>
