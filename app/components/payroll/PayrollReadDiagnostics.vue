<script setup lang="ts">
import type { PayrollDiagnostic } from '~/lib/payroll/central-contract'
import { payrollDiagnosticLocation } from '~/lib/payroll/read-presentation'

defineProps<{ issues: readonly PayrollDiagnostic[] }>()
</script>

<template>
  <details v-if="issues.length" class="panel min-w-0 border-warn/30 bg-warn-soft p-3 text-12px" aria-label="工资资料核对说明">
    <summary class="cursor-pointer font-700">
      有 {{ issues.length }} 项资料需要核对
    </summary>
    <ul class="mt-3 grid gap-3">
      <li v-for="(issue, index) in issues" :key="`${issue.code}:${issue.recordId}:${index}`" class="min-w-0 break-words leading-5">
        <strong>{{ payrollDiagnosticLocation(issue) }}</strong> · {{ issue.message }}
        <details v-if="issue.recordId" class="mt-1 text-ink-faint">
          <summary class="cursor-pointer">
            查看原记录身份
          </summary>
          <p class="mt-1 break-all">
            {{ issue.recordId }}
          </p>
        </details>
      </li>
    </ul>
  </details>
</template>
