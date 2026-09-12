<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { ScheduleHistory, ScheduleHistoryLog } from '~/lib/schedule/history'
import { computed } from 'vue'

const props = defineProps<{ history: DeepReadonly<ScheduleHistory> }>()
const logs = computed(() => [...props.history.logs].reverse())
const titles: Record<string, string> = { schedule_groups: '楼栋分组', schedule_tasks: '工序', schedule_group_buildings: '楼栋范围', task_item_map: '工序分项', task_dependencies: '前后置关系', schedule_task_floor_plans: '楼层计划' }
const labels: Record<string, string> = { name: '名称', scope_basis: '范围依据', contract_bound_at: '绑定日期', planned_start: '计划开始', planned_finish: '计划完成', baseline_start: '基线开始', baseline_finish: '基线完成', duration_days: '工期', manual_progress: '人工进度', lag_days: '间隔天数', is_manual: '人工微调', provisional_qty: '冻结暂估量', source_basis: '数量依据', deleted_at: '移除日期', process_library_name_snapshot: '冻结工序库名称', process_library_version_snapshot: '冻结版本', note: '备注' }
function values(json: string | null): Record<string, unknown> {
  try {
    const parsed = json ? JSON.parse(json) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}
function display(key: string, value: unknown): string {
  if (value == null || value === '')
    return '—'
  if (key === 'scope_basis' || key === 'source_basis')
    return value === 'contract' ? '合同清单' : value === 'provisional' ? '内部暂估' : String(value)
  if (key === 'manual_progress' && typeof value === 'number')
    return `${Math.round(value * 100)}%`
  if (key === 'is_manual')
    return Number(value) ? '已微调' : '自动排布'
  return String(value)
}
function title(log: ScheduleHistoryLog) {
  if (log.operator === 'schedule:bind-contract')
    return '绑定施工合同'
  if (log.operator.includes('conflict'))
    return '调期冲突，停用关系'
  if (log.operator.includes('restore'))
    return '恢复关系'
  if (log.operator.includes('baseline'))
    return '保存计划基线'
  const action = log.action === 'create' ? '新增' : log.action === 'delete' ? '移除' : '修改'
  return `${action}${titles[log.tableName] ?? '计划记录'}`
}
function changes(log: ScheduleHistoryLog) {
  const before = values(log.beforeJson)
  const after = values(log.afterJson)
  return Object.entries(labels).flatMap(([key, label]) => before[key] !== after[key] ? [{ key, label, before: display(key, before[key]), after: display(key, after[key]) }] : [])
}
</script>

<template>
  <details class="panel min-w-0 p-4" data-testid="schedule-history">
    <summary class="cursor-pointer text-13px font-800">
      计划历史与迁入记录
    </summary>
    <div class="mt-3 grid gap-3 text-12px">
      <p v-if="history.migrationEvidence.some(row => row.provisionalDetailStatus === 'legacy-detail-unavailable')" class="rounded bg-warning/8 p-3 text-warning">
        旧排程保留了当时冻结的暂估量，缺少逐户明细，完整性无法追溯；当前模板与合同量不会回填为历史来源。
      </p>
      <section v-if="history.removedTasks.length">
        <h3 class="mb-2 font-700">
          已移除或未归组的历史工序
        </h3>
        <ul class="grid gap-2">
          <li v-for="task in history.removedTasks" :key="task.id" class="rounded border border-line p-3">
            <strong>{{ task.name }}</strong> · {{ task.groupId ? '已移除范围内' : '旧资料未归组' }}
            <p>计划 {{ task.plannedStart }} — {{ task.plannedFinish }} · 基线 {{ task.baselineStart || '—' }} — {{ task.baselineFinish || '—' }}</p>
            <p v-if="task.deletedAt">
              移除于 {{ task.deletedAt }}
            </p>
          </li>
        </ul>
      </section>
      <p v-if="!history.logs.length" class="text-ink-faint">
        当前没有可读的计划变更记录。
      </p>
      <details v-for="log in logs" :key="log.id" class="min-w-0 rounded border border-line p-3">
        <summary class="cursor-pointer">
          {{ title(log) }} · {{ log.createdAt }}
        </summary>
        <dl class="mt-2 grid gap-2">
          <div v-for="change in changes(log)" :key="change.key" class="grid min-w-0 gap-1 sm:grid-cols-[8rem_1fr]">
            <dt class="text-ink-soft">
              {{ change.label }}
            </dt><dd class="break-words">
              {{ change.before }} → {{ change.after }}
            </dd>
          </div>
        </dl>
        <p class="mt-2 break-all text-10px text-ink-faint">
          审计编号：{{ log.id }}
        </p>
      </details>
    </div>
  </details>
</template>
