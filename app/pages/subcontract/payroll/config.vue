<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const native = isDesktopRuntime()
</script>

<template>
  <section v-if="native" class="panel p-4 text-13px" role="status">
    请在桌面工资台账处理原本机配置。此页面用于正式中央 A 工资配置。
  </section>
  <PayrollAConfigScreen v-else />
</template>
