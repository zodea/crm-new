<script setup lang="ts">
import type { CrewDetailMember } from '~/stores/crew-detail'
import { formatMoney } from '~/lib/util/money'
import { maskPhone } from '~/lib/util/privacy'

defineProps<{
  members: readonly CrewDetailMember[]
}>()
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="crew-members-title">
    <SectionHeader
      id="crew-members-title"
      title="班组成员"
      :subtitle="`共 ${members.length} 人 · 归属来自工人档案`"
      :mb="0"
    />

    <div
      v-if="members.length"
      data-testid="crew-members-scroll"
      class="crew-table-scroll overflow-x-auto"
      tabindex="0"
      aria-label="班组成员表格，可横向滚动"
    >
      <table class="crew-table crew-table--members">
        <thead>
          <tr>
            <th scope="col">
              工人
            </th>
            <th scope="col">
              工种
            </th>
            <th scope="col">
              当前项目
            </th>
            <th scope="col">
              在场状态
            </th>
            <th scope="col">
              联系电话
            </th>
            <th scope="col">
              参考日工资
            </th>
            <th scope="col">
              进场日期
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="member in members" :key="member.id">
            <td>
              <NuxtLink
                :to="`/base/worker/${member.id}`"
                class="cell--link font-700"
                :title="member.name"
              >
                {{ member.name }}
              </NuxtLink>
              <NuxtLink
                v-if="member.linkedWorkerId"
                :to="`/base/worker/${member.linkedWorkerId}`"
                class="ml-2 whitespace-nowrap text-11px text-brand no-underline hover:underline"
                :title="`关联人员：${member.linkedWorkerName}`"
              >
                ↔ {{ member.linkedWorkerName }}
              </NuxtLink>
              <span
                v-else-if="member.linkedWorkerName"
                class="ml-2 whitespace-nowrap text-11px text-ink-faint"
                :title="`关联人员：${member.linkedWorkerName}`"
              >
                ↔ {{ member.linkedWorkerName }}
              </span>
            </td>
            <td>{{ member.trade || '—' }}</td>
            <td>
              <NuxtLink
                v-if="member.currentProjectId"
                :to="`/project/${member.currentProjectId}`"
                class="cell--link"
                :title="member.currentProjectName || '未命名项目'"
              >
                {{ member.currentProjectName || '未命名项目' }}
              </NuxtLink>
              <span v-else class="text-ink-faint">—</span>
            </td>
            <td>
              <span :class="member.projectStatus === '在场' ? 'chip-ok' : 'chip'">
                {{ member.projectStatus || '未登记' }}
              </span>
            </td>
            <td class="font-mono">
              {{ maskPhone(member.phone) || '—' }}
            </td>
            <td class="text-right font-mono tabular-nums">
              {{ member.dailyWage == null ? '—' : `${formatMoney(member.dailyWage)} 元/天` }}
            </td>
            <td class="font-mono">
              {{ member.entryDate || '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <StatePanel
      v-else
      kind="empty"
      title="暂无班组成员"
      description="请在工人档案中选择该班组后再返回查看。"
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

.crew-table--members {
  min-width: 760px;
}

.crew-table th,
.crew-table td {
  height: 40px;
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

.crew-table th:nth-child(1) { width: 160px; }
.crew-table th:nth-child(2) { width: 90px; }
.crew-table th:nth-child(3) { width: 150px; }
.crew-table th:nth-child(4) { width: 90px; }
.crew-table th:nth-child(5) { width: 120px; }
.crew-table th:nth-child(6) { width: 110px; }
.crew-table th:nth-child(7) { width: 105px; }
</style>
