<script setup lang="ts">
import type { StatusTone } from '~/lib/project/status'
import type { ProjectDetailTabKey } from '~/lib/project/subtables'
import { computed, shallowRef, watch } from 'vue'
import { PROJECT_STATUS_TONE } from '~/lib/project/status'
import { PROJECT_DETAIL_TABS } from '~/lib/project/subtables'

const props = defineProps<{
  projectId: string
}>()

const route = useRoute()
const router = useRouter()
const store = useProjectStore()

const tabs = PROJECT_DETAIL_TABS
const tabKeys = new Set<ProjectDetailTabKey>(tabs.map(tab => tab.key))
const project = computed(() => store.byId(props.projectId))
const activeTab = shallowRef<ProjectDetailTabKey>(validTab(route.query.tab))

useTabTitle(() => project.value?.name)

const TONE_CHIP: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  muted: 'chip bg-surface-3 text-ink-faint',
  ok: 'chip-ok',
}
const statusChipClass = computed(() => {
  const tone = project.value ? PROJECT_STATUS_TONE[project.value.status] : undefined
  return tone ? TONE_CHIP[tone] : 'chip-brand'
})
const pageState = computed<'ready' | 'loading' | 'error' | 'not-found'>(() => {
  if (project.value)
    return 'ready'
  if (store.loading || !store.loaded)
    return 'loading'
  return store.error ? 'error' : 'not-found'
})

function validTab(value: unknown): ProjectDetailTabKey {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && tabKeys.has(candidate as ProjectDetailTabKey)
    ? candidate as ProjectDetailTabKey
    : 'detail'
}

async function loadProject() {
  try {
    await store.load()
  }
  catch {
    // Store owns the user-facing error. The screen only chooses the shared state surface.
  }
}

function selectTab(value: string | undefined) {
  const next = validTab(value)
  activeTab.value = next
  const query = { ...route.query }
  if (next === 'detail')
    delete query.tab
  else
    query.tab = next
  void router.replace({ query })
}

watch(
  () => route.query.tab,
  value => activeTab.value = validTab(value),
)
watch(
  () => props.projectId,
  () => void loadProject(),
  { immediate: true },
)
</script>

<template>
  <div
    v-if="pageState === 'ready' && project"
    data-ui="project-detail-screen"
    class="project-detail flex min-w-0 flex-col gap-3"
  >
    <StatePanel
      v-if="store.loading"
      kind="loading"
      title="正在刷新项目详情"
      compact
    />
    <StatePanel
      v-else-if="store.error"
      kind="error"
      title="项目详情刷新失败"
      :description="store.error"
      action-label="重新加载"
      compact
      @action="loadProject"
    />

    <header class="panel min-w-0 overflow-hidden" aria-labelledby="project-detail-title">
      <div class="flex min-w-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
        <span
          class="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-14px font-800 text-brand"
          aria-hidden="true"
        >
          项
        </span>
        <div class="min-w-48 flex-[1_1_22rem]">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <h2 id="project-detail-title" class="m-0 min-w-0 break-words text-17px leading-6 font-800 text-ink">
              {{ project.name }}
            </h2>
            <span class="chip bg-surface-3 text-ink-soft">项目信息</span>
            <span class="chip" :class="statusChipClass">{{ project.status }}</span>
          </div>
          <p class="m-0 mt-0.5 break-words text-11px leading-4 text-ink-soft">
            {{ project.code || '未登记项目编号' }} · {{ project.contractName || project.region || '未登记合同名称' }}
          </p>
        </div>
        <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2" role="group" aria-label="项目详情操作">
          <NuxtLink :to="`/project/form/${project.id}`" class="btn-secondary" aria-label="编辑项目">
            <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑
          </NuxtLink>
          <NuxtLink to="/project" class="btn-ghost" aria-label="关闭项目详情">
            <span class="i-lucide-x mr-1" aria-hidden="true" />关闭
          </NuxtLink>
        </div>
      </div>

      <dl class="project-detail__metadata grid border-t border-line bg-line">
        <div class="bg-panel px-3 py-2">
          <dt class="text-9px text-ink-faint">
            业务流程阶段
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ project.status || '未登记' }}
          </dd>
        </div>
        <div class="bg-panel px-3 py-2">
          <dt class="text-9px text-ink-faint">
            经营类型
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ project.operationType || '未登记' }}
          </dd>
        </div>
        <div class="bg-panel px-3 py-2">
          <dt class="text-9px text-ink-faint">
            项目经理
          </dt>
          <dd class="m-0 mt-0.5 text-12px text-ink">
            {{ project.manager || '未登记' }}
          </dd>
        </div>
        <div class="bg-panel px-3 py-2">
          <dt class="text-9px text-ink-faint">
            客户(甲方)
          </dt>
          <dd class="m-0 mt-0.5 break-words text-12px text-ink">
            {{ project.developer || '未登记' }}
          </dd>
        </div>
        <div class="bg-panel px-3 py-2">
          <dt class="text-9px text-ink-faint">
            承包单位
          </dt>
          <dd class="m-0 mt-0.5 break-words text-12px text-ink">
            {{ project.contractor || '未登记' }}
          </dd>
        </div>
      </dl>
    </header>

    <div data-project-module="metrics">
      <ProjectMetrics :project-id="props.projectId" />
    </div>

    <div class="project-detail__body grid min-w-0 items-start gap-3">
      <main class="min-w-0">
        <div data-project-module="workflow">
          <ProjectWorkflowPanel :project="project" />
        </div>
        <div data-project-module="schedule">
          <ProjectScheduleCard :project-id="props.projectId" />
        </div>
        <div data-project-module="timeline">
          <ProjectTimeline :project-id="props.projectId" />
        </div>

        <section data-project-module="tabs" class="panel min-w-0 overflow-hidden" aria-label="项目业务明细">
          <nav class="min-w-0 overflow-x-auto border-b border-line px-3 pt-1" aria-label="项目详情业务页签">
            <SegTab
              :model-value="activeTab"
              :tabs="[...tabs]"
              @update:model-value="selectTab"
            />
          </nav>
          <div data-ui="project-detail-table-scroll" class="min-w-0 overflow-x-auto p-3">
            <ProjectDetailTab v-if="activeTab === 'detail'" :project="project" />
            <ProjectSubTables v-else :tab="activeTab" :project-id="props.projectId" />
          </div>
        </section>
      </main>

      <aside class="flex min-w-0 flex-col gap-3" aria-label="项目组成员与文件">
        <div data-project-module="team">
          <ProjectTeamPanel :project="project" />
        </div>
        <div data-project-module="files">
          <ProjectFileCabinet :project-id="props.projectId" />
        </div>
      </aside>
    </div>
  </div>

  <StatePanel
    v-else-if="pageState === 'loading'"
    kind="loading"
    title="正在加载项目详情"
  />
  <StatePanel
    v-else-if="pageState === 'error'"
    kind="error"
    title="项目详情加载失败"
    :description="store.error"
    action-label="重新加载"
    @action="loadProject"
  />
  <StatePanel
    v-else
    kind="empty"
    title="项目不存在或已被删除"
    description="该项目可能已在别处被删除，可返回项目列表查看。"
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
  gap: 1px;
}

.project-detail__body {
  grid-template-columns: minmax(0, 1fr);
}

@container project-detail (min-width: 68rem) {
  .project-detail__body {
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 18rem);
  }
}
</style>
