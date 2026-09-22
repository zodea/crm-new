<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const route = useRoute()
</script>

<template>
  <section v-if="isDesktopRuntime()" class="panel p-4" role="status">
    请在中央工作区办理正式工资出具。
  </section>
  <section v-else-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    正式工资编号需要明确正式来源，请从原工资详情进入。
  </section>
  <PayrollNumberingScreen v-else />
</template>
