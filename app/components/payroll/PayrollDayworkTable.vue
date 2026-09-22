<script setup lang="ts">
import type { PayrollDayworkRecordRead } from '~/lib/payroll/central-daywork-contract'
import { c2Number, dayworkState } from '~/lib/payroll/c2-presentation'

defineProps<{ records: PayrollDayworkRecordRead[], origin: 'real' | 'demo', returnTo: string, writable: boolean, focusedId?: string }>()
const emit = defineEmits<{ confirm: [id: string] }>()
</script>

<template>
  <div class="max-w-full overflow-x-auto" tabindex="0" aria-label="签工记录表横向滚动">
    <table class="daywork-table">
      <thead><tr><th>用工人 / 日期</th><th>时间 / 工数</th><th>施工内容</th><th>证明信息</th><th>确认与占用</th><th>操作</th></tr></thead><tbody>
        <tr v-for="record in records" :id="`daywork-${record.id}`" :key="record.id" :data-daywork-id="record.id" :class="{ 'bg-brand-soft': focusedId === record.id }" tabindex="-1">
          <td>{{ record.workerName || '姓名未记录' }}<br>{{ record.workDate }}<span class="mt-1 block text-ink-soft">{{ record.crewName || '未记录班组' }}</span></td>
          <td>{{ record.startTime ?? '未记录' }}–{{ record.endTime ?? '未记录' }}<br>{{ c2Number(record.laborUnits) }} 工</td><td class="content">
            {{ record.workContent ?? '内容未记录' }}
          </td><td class="content">
            {{ record.witness ?? '证明人未记录' }}<br>{{ record.confirmedOn ?? '确认日期未记录' }}
          </td>
          <td class="content">
            <strong>{{ dayworkState(record.status) }}</strong><p v-if="record.availability === 'occupied'">
              已由其他工资领用
            </p><p v-if="record.availability === 'invalid' || record.availability === 'deleted'">
              原资料只读
            </p><p v-for="(reason, index) in record.eligibility.reasons" :key="index" class="mt-1 text-warn">
              {{ reason }}
            </p><p v-for="(diagnostic, index) in record.diagnostics" :key="index" class="mt-1 text-warn">
              {{ diagnostic.message }}
            </p>
          </td>
          <td>
            <div class="flex flex-wrap gap-2">
              <NuxtLink v-if="writable && record.eligibility.canEdit" :to="{ path: `/subcontract/daywork/form/${encodeURIComponent(record.id)}`, query: { origin, returnTo } }" class="cell--link">
                编辑签工
              </NuxtLink><KitButton v-if="writable && record.eligibility.canConfirm" @click="emit('confirm', record.id)">
                人工确认
              </KitButton>
            </div><details class="mt-2">
              <summary>原记录证据</summary><pre class="mt-2 max-h-64 max-w-80 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify(record.original, null, 2) }}</pre>
            </details>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.daywork-table { width:100%; min-width:960px; border-collapse:collapse; font-size:12px; }
th, td { border-bottom:1px solid var(--line); padding:12px; text-align:left; vertical-align:top; }
th { background:var(--surface-2); white-space:nowrap; }
.content { min-width:170px; max-width:300px; white-space:normal; overflow-wrap:anywhere; }
</style>
