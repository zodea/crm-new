<script setup lang="ts">
import type { QuantityHollowRecord } from '~/lib/quantity/central-hollow-contract'

defineProps<{ record: QuantityHollowRecord }>()
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="当前空鼓原责任与余量">
    <h2 class="break-words text-15px font-700">
      {{ record.location.locationLabel }}
    </h2><p class="break-words text-12px">
      原{{ record.originalParty.kind === 'worker' ? '施工人' : '班组责任' }}：{{ record.originalPartyName }}
    </p><div class="grid min-w-0 grid-cols-3 gap-3 text-12px">
      <div>
        <span class="text-ink-faint">当前检查</span><p class="mt-1 font-mono text-16px font-700">
          {{ record.inspection.input.count }} 处
        </p>
      </div><div>
        <span class="text-ink-faint">已整改</span><p class="mt-1 font-mono text-16px font-700">
          {{ record.rectifiedCount }} 处
        </p>
      </div><div>
        <span class="text-ink-faint">未整改</span><p class="mt-1 font-mono text-16px font-700" :class="record.remainingCount ? 'text-warn' : 'text-ok'">
          {{ record.remainingCount }} 处
        </p>
      </div>
    </div><p class="text-12px leading-5 text-ink-soft">
      {{ record.inspection.input.count === 0 ? '已明确检查为零处；原检查记录保留。' : record.remainingCount === 0 ? '已登记的空鼓全部整改；原检查及销记历史保留。' : '数量来自原检查与追加整改，工资是否扣款由经办人在对应工资单另行确认。' }}
    </p>
  </section>
</template>
