<script setup lang="ts">
defineProps<{
  bizTypes: readonly string[]
}>()

defineEmits<{
  back: []
  select: [bizType: string]
}>()
</script>

<template>
  <section
    class="panel mx-auto max-w-920px p-5"
    data-testid="payment-type-step"
  >
    <button type="button" class="mb-3 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-12px text-brand-deep" @click="$emit('back')">
      <span class="i-lucide-arrow-left" aria-hidden="true" />
      返回付款申请
    </button>
    <h1 class="text-20px font-800 text-ink">
      选择付款业务类型
    </h1>
    <p class="mt-2 text-13px text-ink-soft">
      业务类型决定项目、合同、结算与回票校验规则，进入表单后仍可调整。
    </p>
    <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="bizType in bizTypes"
        :key="bizType"
        type="button"
        class="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-left text-13px font-700 text-ink transition-colors hover:border-brand hover:bg-brand-soft"
        @click="$emit('select', bizType)"
      >
        {{ bizType }}
      </button>
    </div>
  </section>
</template>
