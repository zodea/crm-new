<script setup lang="ts">
import type { PayrollWorkbookArchiveSummary } from '~/lib/payroll/central-workbook-contract'

defineProps<{ versions: PayrollWorkbookArchiveSummary[], disabled: boolean }>()
defineEmits<{ open: [string] }>()
</script>

<template>
  <section id="section-history" class="panel min-w-0 p-4">
    <SectionHeader title="已保存的工资目录" subtitle="重新打开保持原编号、名册版本和保存时点的实际收付。后来资料变化不会改写旧目录。" />
    <ul v-if="versions.length" class="mt-3 grid gap-2">
      <li v-for="version in versions" :key="version.id" class="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 text-12px">
        <div class="min-w-0">
          <strong>{{ version.mode === 'leader-cycle' ? '负责人全周期' : '项目按月' }} · 版本 {{ version.version }}</strong><p class="mt-1">
            {{ version.statementIds.length }} 份工资 · {{ version.completeness === 'complete' ? '资料完整' : '部分资料' }} · {{ version.createdAt }}
          </p><p class="mt-1 break-all text-ink-soft">
            {{ version.id }}
          </p>
        </div><KitButton :disabled="disabled" @click="$emit('open', version.id)">
          打开原目录
        </KitButton>
      </li>
    </ul>
    <p v-else class="mt-3 text-13px text-ink-soft">
      当前项目还没有保存工资目录。
    </p>
  </section>
</template>
