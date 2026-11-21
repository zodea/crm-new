<script setup lang="ts">
import WorkerRosterArchiveScreen from '~/components/worker/WorkerRosterArchiveScreen.vue'

const route = useRoute()
</script>

<template>
  <section v-if="route.query.origin !== 'real'" class="panel p-4" role="alert">
    名册归档需要明确正式来源；请从正式工资台账进入。
  </section>
  <WorkerRosterArchiveScreen v-else />
</template>
