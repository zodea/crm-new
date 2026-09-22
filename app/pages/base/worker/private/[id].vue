<script setup lang="ts">
import { isDesktopRuntime } from '~/lib/platform/runtime'

const route = useRoute()
</script>

<template>
  <section v-if="isDesktopRuntime()" class="panel p-4" role="status">
    此归档入口用于中央正式资料，请在中央工作区打开。
  </section>
  <section v-else-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    工人私密资料需要明确正式来源；请从正式工人详情进入。
  </section>
  <WorkerPrivateProfileScreen v-else />
</template>
