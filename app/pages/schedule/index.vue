<script setup lang="ts">
import HomeScheduleSourceScreen from '~/components/schedule/HomeScheduleSourceScreen.vue'
import ScheduleScreen from '~/components/schedule/ScheduleScreen.vue'

const route = useRoute()
</script>

<template>
  <HomeScheduleSourceScreen v-if="route.query.from === 'home'" />
  <ScheduleScreen v-else />
</template>
