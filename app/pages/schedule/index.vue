<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <HomeScheduleSourceScreen v-if="route.query.from === 'home'" />
  <ScheduleScreen v-else />
</template>
