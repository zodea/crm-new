<script setup lang="ts">
import type { CrewPenaltyRecord } from '~/stores/crew-detail'
import { formatMoney } from '~/lib/util/money'

defineProps<{
  penalties: readonly CrewPenaltyRecord[]
}>()

function statusClass(status: string): string {
  if (status === 'deducted' || status === 'repaired_other')
    return 'chip-danger'
  if (status === 'repaired_self')
    return 'chip-ok'
  return 'chip-warn'
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="crew-penalties-title">
    <SectionHeader
      id="crew-penalties-title"
      title="扣罚记录"
      subtitle="仅展示项目处罚事实，本页不修改"
      :mb="0"
    />

    <div
      v-if="penalties.length"
      class="crew-table-scroll overflow-x-auto"
      tabindex="0"
      aria-label="班组扣罚记录表格，可横向滚动"
    >
      <table class="crew-table crew-table--penalties">
        <thead>
          <tr>
            <th scope="col">
              日期
            </th>
            <th scope="col">
              来源
            </th>
            <th scope="col">
              项目
            </th>
            <th scope="col">
              位置
            </th>
            <th scope="col">
              原因
            </th>
            <th scope="col">
              金额
            </th>
            <th scope="col">
              状态
            </th>
            <th scope="col">
              记录
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="penalty in penalties" :key="penalty.id">
            <td class="font-mono">
              {{ penalty.penaltyDate || '—' }}
            </td>
            <td>
              <span class="chip">{{ penalty.sourceLabel }}</span>
            </td>
            <td>
              <NuxtLink
                v-if="penalty.projectId"
                :to="`/project/${penalty.projectId}`"
                class="cell--link"
              >
                {{ penalty.projectName || '未命名项目' }}
              </NuxtLink>
              <span v-else class="text-ink-faint">—</span>
            </td>
            <td :title="penalty.location">
              {{ penalty.location || '—' }}
            </td>
            <td :title="penalty.reason">
              {{ penalty.reason || '—' }}
            </td>
            <td class="text-right font-mono font-700 tabular-nums">
              {{ formatMoney(penalty.amount, { currency: true }) }}
            </td>
            <td>
              <span :class="statusClass(penalty.status)">
                {{ penalty.statusLabel }}
              </span>
            </td>
            <td>
              <NuxtLink :to="`/project/penalty/${penalty.id}`" class="cell--link">
                {{ penalty.no || '查看' }}
              </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <StatePanel
      v-else
      kind="empty"
      title="暂无扣罚记录"
      description="没有与该班组直接关联的有效扣罚事实。"
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

.crew-table--penalties {
  min-width: 900px;
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

.crew-table th:nth-child(1) { width: 100px; }
.crew-table th:nth-child(2) { width: 120px; }
.crew-table th:nth-child(3) { width: 150px; }
.crew-table th:nth-child(4) { width: 145px; }
.crew-table th:nth-child(5) { width: 180px; }
.crew-table th:nth-child(6) { width: 100px; }
.crew-table th:nth-child(7) { width: 100px; }
.crew-table th:nth-child(8) { width: 100px; }
</style>
