<script setup lang="ts">
import type { PayrollOfficialIssue } from '~/lib/payroll/central-numbering-contract'

defineProps<{ issue: PayrollOfficialIssue }>()
</script>

<template>
  <div class="official-identity" aria-label="正式出具身份">
    <p><strong>正式工资编号：{{ issue.number }}</strong> · {{ issue.formatFamily }}</p>
    <p>原工资：{{ issue.statementId }}</p>
    <p>正式出具：{{ issue.issuedAt }} · 经办：{{ issue.operatorId }}</p>
  </div>
</template>

<style scoped>
.official-identity { font-size: 9pt; overflow-wrap: anywhere; margin: 3mm 0; }
.official-identity p { margin: 1mm 0; }
</style>
