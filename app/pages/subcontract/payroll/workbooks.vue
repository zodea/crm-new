<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const route = useRoute()
</script>

<template>
  <section v-if="isDesktopRuntime()" class="panel p-4" role="status">
    工资归档目录使用中央正式资料，请在中央工作区打开。
  </section>
  <section v-else-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    请从正式工资台账进入完整工作簿。
  </section>
  <PayrollWorkbookScreen v-else />
</template>
