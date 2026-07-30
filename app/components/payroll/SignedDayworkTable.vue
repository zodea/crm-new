<script setup lang="ts">
import type { SignedDayworkRecord } from '~/lib/payroll/daywork'
import StatePanel from '~/components/ui/StatePanel.vue'

defineProps<{
  records: SignedDayworkRecord[]
  loading: boolean
}>()

const emit = defineEmits<{
  edit: [record: SignedDayworkRecord]
}>()
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-label="逐日签工记录">
    <header class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div>
        <h2 class="text-14px font-800 text-ink">
          逐日签工记录
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          共 {{ records.length }} 条；按日期、时段和人员形成可追溯事实。
        </p>
      </div>
      <span class="text-11px text-ink-faint">表格仅在本区域横向滚动</span>
    </header>
    <StatePanel
      v-if="loading"
      kind="loading"
      title="正在读取签工记录"
      description="请稍候。"
    />
    <StatePanel
      v-else-if="!records.length"
      kind="empty"
      title="当前范围没有签工记录"
      description="先在上方录入；只有已确认记录会进入 C2 工资。"
    />
    <div v-else class="daywork-table" tabindex="0">
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>施工内容</th>
            <th>起止时间</th>
            <th>用工人</th>
            <th>用工数</th>
            <th>证明人</th>
            <th>确认日期</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id">
            <td class="font-mono">
              {{ record.workDate }}
            </td>
            <td class="daywork-table__content" :title="record.workContent">
              {{ record.workContent }}
            </td>
            <td class="font-mono">
              {{ record.startTime }}–{{ record.endTime }}
            </td>
            <td>{{ record.workerName }}</td>
            <td class="font-mono font-700">
              {{ record.laborUnits }}
            </td>
            <td>{{ record.witness || '—' }}</td>
            <td class="font-mono">
              {{ record.confirmedOn || '—' }}
            </td>
            <td>
              <span :class="record.status === 'confirmed' ? 'chip-ok' : 'chip-warn'">
                {{ record.status === 'confirmed' ? '已确认' : '待确认' }}
              </span>
            </td>
            <td>
              <button
                type="button"
                class="btn-ghost"
                aria-label="编辑签工记录"
                @click="emit('edit', record)"
              >
                编辑
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.daywork-table {
  max-width: 100%;
  overflow-x: auto;
}
table {
  width: 100%;
  min-width: 58rem;
  border-collapse: collapse;
  font-size: .8125rem;
}
th,
td {
  height: 2.625rem;
  border-bottom: 1px solid var(--line);
  padding: 0 .75rem;
  text-align: left;
  white-space: nowrap;
}
th {
  background: var(--surface-2);
  color: var(--ink-soft);
  font-size: .75rem;
}
.daywork-table__content {
  max-width: 24rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
