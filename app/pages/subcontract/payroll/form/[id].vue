<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const native = isDesktopRuntime()
</script>

<template>
  <section v-if="native" class="panel p-4 text-13px" role="status">
    请在桌面工资台账中查看和处理原工资。此整页用于正式中央 A 工资草稿。
  </section>
  <CentralPayrollDraftFormPage v-else />
</template>
