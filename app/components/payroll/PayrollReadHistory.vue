<script setup lang="ts">
import type { PayrollHistoryEntry } from '~/lib/payroll/central-contract'
import { computed } from 'vue'
import { payrollHistoryPresentation } from '~/lib/payroll/read-presentation'

const props = defineProps<{ history: readonly PayrollHistoryEntry[] }>()
const entries = computed(() => props.history.map(payrollHistoryPresentation))
</script>

<template>
  <details class="panel min-w-0 p-4 text-12px" aria-label="工资操作历史">
    <summary class="cursor-pointer font-700">
      查看操作历史（{{ entries.length }}）
    </summary>
    <p v-if="!entries.length" class="mt-3 text-ink-faint">
      原资料未提供可读取的操作历史。
    </p>
    <ol class="mt-3 grid gap-3">
      <li v-for="entry in entries" :key="entry.id" class="min-w-0 border-t border-line pt-3">
        <strong>{{ entry.subject }} · {{ entry.action }}</strong>
        <p class="mt-1 break-words text-ink-faint">
          {{ entry.time }} · {{ entry.operator }}
        </p>
        <dl class="mt-2 grid gap-2">
          <div v-for="change in entry.changes" :key="change.label" class="grid gap-1 sm:grid-cols-[8rem_1fr]">
            <dt class="text-ink-soft">
              {{ change.label }}
            </dt><dd class="min-w-0 break-words">
              {{ change.before }} → {{ change.after }}
            </dd>
          </div>
        </dl>
        <p v-if="!entry.changes.length" class="mt-2 text-ink-faint">
          这条历史未提供可识别的业务字段变化。
        </p>
        <details class="mt-2">
          <summary class="cursor-pointer text-ink-soft">
            查看本次变更原文
          </summary><pre tabindex="0" class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all bg-surface-3 p-3">{{ history.find(item => item.id === entry.id)?.beforeRaw ?? '变更前原文未记录' }}
→
          {{ history.find(item => item.id === entry.id)?.afterRaw ?? '变更后原文未记录' }}</pre>
        </details>
      </li>
    </ol>
  </details>
</template>
