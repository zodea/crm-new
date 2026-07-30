<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { workerPresenceStatusLabel, workerRecordStatusLabel } from '~/lib/worker/detail'
import { useWorkerDetailStore } from '~/stores/worker-detail'

const route = useRoute()
const store = useWorkerDetailStore()
const workerId = computed(() => String(route.params.id ?? ''))
const detail = computed(() => store.loadedId === workerId.value ? store.current : null)
const state = computed(() => {
  if (store.loading || store.loadedId !== workerId.value)
    return 'loading'
  if (store.error)
    return 'error'
  return detail.value ? 'ready' : 'not-found'
})

useTabTitle(() => detail.value?.worker.name)

watch(workerId, id => void store.load(id), { immediate: true })
</script>

<template>
  <EntityDetailShell
    :title="detail?.worker.name || '工人详情'"
    :subtitle="detail ? `${detail.worker.trade || '未设置工种'} · ${detail.crew?.name || '未加入班组'}` : ''"
    :state="state"
    :state-title="state === 'not-found'
      ? '工人不存在或已删除'
      : state === 'error' ? '工人详情加载失败' : ''"
    :state-description="store.error"
    :state-action-label="state === 'error' ? '重新加载' : ''"
    back-to="/base/worker"
    back-label="返回工人列表"
    aside-label="班组和关联人员"
    @state-action="store.load(workerId)"
  >
    <template #status>
      <div v-if="detail" class="flex flex-wrap gap-1.5">
        <span class="status-chip">档案：{{ workerRecordStatusLabel(detail.worker.status) }}</span>
        <span class="status-chip bg-brand-soft text-brand">在场：{{ workerPresenceStatusLabel(detail.worker.projectStatus) }}</span>
      </div>
    </template>
    <template #actions>
      <NuxtLink v-if="detail" :to="`/base/worker/form/${detail.worker.id}`" class="btn-secondary">
        <span class="i-lucide-pencil mr-1" aria-hidden="true" />编辑
      </NuxtLink>
    </template>
    <template #summary>
      <WorkerDetailSummary v-if="detail" :summary="detail.summary" />
    </template>

    <div v-if="detail" class="grid min-w-0 gap-4">
      <WorkerDetailProfile :detail="detail" />
      <WorkerDetailProjects :projects="detail.projects" :assignments="detail.assignments" />
      <WorkerDetailLaborFacts
        :attendance="detail.attendance"
        :daywork="detail.daywork"
        :wage-statements="detail.wageStatements"
        :penalties="detail.penalties"
      />
    </div>

    <template v-if="detail" #aside>
      <WorkerDetailAside :crew="detail.crew" :related-workers="detail.relatedWorkers" />
    </template>
  </EntityDetailShell>
</template>
