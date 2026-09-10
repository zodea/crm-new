<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <HomeScheduleSourceScreen v-if="route.query.origin !== undefined" />
  <ScheduleScreen v-else />
</template>
