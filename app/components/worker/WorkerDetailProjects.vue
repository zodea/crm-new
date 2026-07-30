<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { WorkerAssignment, WorkerProject } from '~/lib/worker/detail'

defineProps<{
  projects: DeepReadonly<WorkerProject[]>
  assignments: DeepReadonly<WorkerAssignment[]>
}>()

const assignmentColumns: KitTableColumn[] = [
  { field: 'projectName', title: '项目', minWidth: 150, fixed: 'left' },
  { field: 'unitName', title: '楼栋 / 楼层 / 户', minWidth: 190, slot: 'unit' },
  { field: 'trade', title: '工种', width: 100 },
  { field: 'scopes', title: '责任范围', minWidth: 220, slot: 'scopes' },
  { field: 'completedStageCount', title: '完成阶段', width: 96, align: 'right' },
  { title: '下钻', width: 104, slot: 'action', align: 'right', resizable: false },
]

function scopesLabel(item: DeepReadonly<WorkerAssignment>): string {
  return item.scopes
    .map(scope => `${scope.roomName}·${scope.itemName}`)
    .join('；') || '未细分'
}
</script>

<template>
  <section class="panel min-w-0 p-4" data-testid="worker-projects">
    <SectionHeader title="项目与工程量责任" subtitle="项目来源和责任单元均来自现有业务记录" />
    <div v-if="projects.length" class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <NuxtLink
        v-for="project in projects"
        :key="project.id"
        :to="`/project/${project.id}`"
        class="rounded border border-line bg-surface-2 p-3 no-underline hover:border-brand"
      >
        <div class="truncate text-13px font-700 text-ink">
          {{ project.name }}
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
          <span v-for="source in project.sources" :key="source" class="status-chip">{{ source }}</span>
        </div>
      </NuxtLink>
    </div>
    <p v-else class="m-0 mt-2 text-12px text-ink-faint">
      暂无当前项目或历史参与记录。
    </p>

    <h3 class="m-0 mt-4 border-t border-line pt-4 text-13px font-700 text-ink">
      直接责任单元
    </h3>
    <div
      class="min-w-0"
      data-testid="worker-assignment-scroll"
      role="region"
      tabindex="0"
      aria-label="工人直接责任单元表格，可横向滚动"
    >
      <KitTable
        :columns="assignmentColumns"
        :data="[...assignments]"
        :min-rows="4"
        :empty="{
          title: '暂无直接责任单元',
          description: '当前没有直接分配到该工人的工程量责任。',
        }"
      >
        <template #unit="{ row }">
          {{ row.buildingName }} / {{ row.floorName }} / {{ row.unitName }}
        </template>
        <template #scopes="{ row }">
          {{ scopesLabel(row) }}
        </template>
        <template #action="{ row }">
          <NuxtLink
            :to="`/subcontract/quantity/${row.projectId}/${row.unitId}`"
            class="cell--link whitespace-nowrap"
          >
            户施工详情
          </NuxtLink>
        </template>
      </KitTable>
    </div>
  </section>
</template>
