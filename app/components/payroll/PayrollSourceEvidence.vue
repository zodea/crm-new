<script setup lang="ts">
import type { PayrollSourceEvidence } from '~/lib/payroll/central-contract'

defineProps<{ evidence: readonly PayrollSourceEvidence[] }>()
const names: Record<string, string> = { configs: '工资配置', statements: '工资头', lines: '工资明细', members: '请款成员', allocations: '收款分配', attendance: '考勤', daywork: '签工', statementDaywork: '工资与签工关联', logs: '操作历史' }
</script>

<template>
  <details v-if="evidence.length" class="panel min-w-0 p-4 text-12px" aria-label="迁入工资原始记录">
    <summary class="cursor-pointer font-700">
      查看迁入原始记录
    </summary>
    <p class="mt-3 leading-5 text-ink-soft">
      以下保留迁入时的原值与原身份，包含未能建立关联的记录；不会用当前资料补齐。
    </p>
    <section v-for="(entry, index) in evidence" :key="entry.entityId" class="mt-4 grid min-w-0 gap-2 border-t border-line pt-3">
      <h3 class="font-700">
        来源记录 {{ index + 1 }}
      </h3>
      <details v-for="(label, key) in names" :key="key">
        <summary class="cursor-pointer">
          {{ label }}原文
        </summary><pre tabindex="0" class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all bg-surface-3 p-3 leading-5">{{ JSON.stringify(entry.source[key] ?? null, null, 2) }}</pre>
      </details>
      <details>
        <summary class="cursor-pointer">
          原身份对应关系
        </summary><pre tabindex="0" class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all bg-surface-3 p-3 leading-5">{{ JSON.stringify(entry.mappings, null, 2) }}</pre>
      </details>
    </section>
  </details>
</template>
