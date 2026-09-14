<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const native = isDesktopRuntime()
const route = useRoute()
</script>

<template>
  <section v-if="native" class="panel p-4 text-13px" role="status">
    请在桌面工资台账处理原本机配置。此页面用于正式中央 A 工资配置。
  </section>
  <PayrollC1ConfigScreen v-else-if="route.query.format === 'C1'" />
  <PayrollAConfigScreen v-else-if="route.query.format == null || route.query.format === 'A'" />
  <section v-else class="panel p-4 text-warn" role="status">
    该格式的中央配置尚未开放。
  </section>
</template>
