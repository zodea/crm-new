<script setup lang="ts">
import type { CrewProjectAssociation } from '~/stores/crew-detail'
import { formatMoney } from '~/lib/util/money'

defineProps<{
  projects: readonly CrewProjectAssociation[]
}>()
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="crew-projects-title">
    <SectionHeader
      id="crew-projects-title"
      title="项目参与与核算关联"
      subtitle="按在场成员、工程量责任或工资单汇总；没有真实关联的项目不显示"
      :mb="0"
    />

    <div
      v-if="projects.length"
      data-testid="crew-projects-scroll"
      class="crew-table-scroll overflow-x-auto"
      tabindex="0"
      aria-label="班组项目关联表格，可横向滚动"
    >
      <table class="crew-table crew-table--projects">
        <thead>
          <tr>
            <th scope="col">
              项目
            </th>
            <th scope="col">
              关联依据
            </th>
            <th scope="col">
              在场成员
            </th>
            <th scope="col">
              工程量责任
            </th>
            <th scope="col">
              阶段完成
            </th>
            <th scope="col">
              工资单
            </th>
            <th scope="col">
              工资单应付
            </th>
            <th scope="col">
              已发工资
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="project in projects" :key="project.projectId">
            <td>
              <NuxtLink :to="`/project/${project.projectId}`" class="cell--link font-700">
                {{ project.projectName || '未命名项目' }}
              </NuxtLink>
              <span v-if="project.projectCode" class="mt-0.5 block text-10px text-ink-faint">
                {{ project.projectCode }}
              </span>
            </td>
            <td>
              <div class="flex flex-wrap gap-1">
                <span v-for="source in project.sources" :key="source" class="chip">
                  {{ source }}
                </span>
              </div>
            </td>
            <td class="text-right font-mono tabular-nums">
              {{ project.activeMemberCount }} 人
            </td>
            <td class="text-right font-mono tabular-nums">
              {{ project.assignedUnitCount }} 户 / {{ project.assignmentCount }} 条
            </td>
            <td class="text-right font-mono tabular-nums">
              {{ project.completedStageCount }} 项
            </td>
            <td class="text-right font-mono tabular-nums">
              {{ project.wageStatementCount }} 份
            </td>
            <td class="text-right font-mono tabular-nums">
              {{ formatMoney(project.wageGrossAmount, { currency: true }) }}
            </td>
            <td class="text-right font-mono font-700 tabular-nums">
              {{ formatMoney(project.releasedWageAmount, { currency: true }) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <StatePanel
      v-else
      kind="empty"
      title="暂无项目关联"
      description="当前班组还没有在场成员、工程量责任或工资单关联。"
      compact
      class="m-3"
    />
  </section>
</template>

<style scoped>
.crew-table-scroll {
  overscroll-behavior-inline: contain;
}

.crew-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  color: var(--ink-soft);
  font-size: 12px;
}

.crew-table--projects {
  min-width: 980px;
}

.crew-table th,
.crew-table td {
  height: 42px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 7px 10px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crew-table th {
  background: var(--surface-2);
  color: var(--ink-soft);
  font-weight: 700;
}

.crew-table th:nth-child(1) { width: 170px; }
.crew-table th:nth-child(2) { width: 200px; }
.crew-table th:nth-child(3) { width: 95px; }
.crew-table th:nth-child(4) { width: 135px; }
.crew-table th:nth-child(5) { width: 90px; }
.crew-table th:nth-child(6) { width: 80px; }
.crew-table th:nth-child(7) { width: 105px; }
.crew-table th:nth-child(8) { width: 105px; }
</style>
