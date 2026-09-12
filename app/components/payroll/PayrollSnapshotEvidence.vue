<script setup lang="ts">
import type { PayrollSnapshot } from '~/lib/payroll/central-contract'
import { computed } from 'vue'
import { payrollSnapshotLabel } from '~/lib/payroll/read-presentation'

const props = defineProps<{ snapshot: PayrollSnapshot }>()
const parsed = computed(() => props.snapshot.data ? JSON.stringify(props.snapshot.data, null, 2) : null)
</script>

<template>
  <section class="panel min-w-0 p-4 text-12px" aria-label="发放快照证据">
    <h2 class="font-700">
      {{ payrollSnapshotLabel(snapshot.state) }}
    </h2>
    <p class="mt-2 leading-5 text-ink-soft">
      已发工资按保存的发放记录展示；缺项不会用今天的姓名、配置或分配补齐。
    </p>
    <ul v-if="snapshot.issues.length" class="mt-2 grid gap-1 text-warn">
      <li v-for="(issue, index) in snapshot.issues" :key="index">
        {{ issue }}
      </li>
    </ul>
    <details v-if="snapshot.raw !== null" class="mt-3">
      <summary class="cursor-pointer">
        查看保存的发放原文
      </summary><pre tabindex="0" class="mt-2 max-h-90 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-3 p-3 leading-5">{{ snapshot.raw }}</pre>
    </details>
    <details v-if="snapshot.originalRaw !== null && snapshot.originalRaw !== snapshot.raw" class="mt-3">
      <summary class="cursor-pointer">
        查看迁入前原文
      </summary><pre tabindex="0" class="mt-2 max-h-90 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-3 p-3 leading-5">{{ snapshot.originalRaw }}</pre>
    </details>
    <details v-if="parsed" class="mt-3">
      <summary class="cursor-pointer">
        查看完整发放记录内容
      </summary><pre tabindex="0" class="mt-2 max-h-90 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-3 p-3 leading-5">{{ parsed }}</pre>
    </details>
    <p v-if="snapshot.raw === null" class="mt-3 text-ink-faint">
      原资料未保留发放原文。
    </p>
  </section>
</template>
