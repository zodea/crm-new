<script setup lang="ts">
import type { ContractStage } from '~/lib/contract/detail'

defineProps<{
  stages: readonly ContractStage[]
}>()
</script>

<template>
  <section class="panel p-4" aria-labelledby="contract-stage-title">
    <SectionHeader
      id="contract-stage-title"
      title="合同阶段"
    />
    <ol class="contract-stage-grid mt-3 grid gap-2">
      <li
        v-for="(stage, index) in stages"
        :key="stage.key"
        class="min-w-0 border border-line px-3 py-2.5"
        :class="{
          'border-brand/45 bg-brand-soft': stage.state === 'current',
          'bg-surface-2': stage.state === 'complete',
        }"
        :aria-current="stage.state === 'current' ? 'step' : undefined"
      >
        <div class="flex items-center gap-2">
          <span
            class="grid h-5 w-5 shrink-0 place-items-center border border-line text-10px font-800"
            :class="stage.state === 'pending' ? 'text-ink-faint' : 'border-brand bg-brand text-white'"
            aria-hidden="true"
          >
            <span v-if="stage.state === 'complete'" class="i-lucide-check h-3 w-3" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="truncate text-12px font-700 text-ink" :title="stage.label">
            {{ stage.label }}
          </span>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.contract-stage-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
}
</style>
