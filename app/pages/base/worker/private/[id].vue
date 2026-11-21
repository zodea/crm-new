<script setup lang="ts">
import WorkerPrivateProfileScreen from '~/components/worker/WorkerPrivateProfileScreen.vue'

const route = useRoute()
</script>

<template>
  <section v-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    工人私密资料需要明确正式来源；请从正式工人详情进入。
  </section>
  <WorkerPrivateProfileScreen v-else />
</template>
