<script setup lang="ts">
import ScheduleScreen from '~/components/schedule/ScheduleScreen.vue'
import HomeScheduleSourceScreen from '~/pages/schedule/_components/HomeScheduleSourceScreen.vue'

const route = useRoute()
</script>

<template>
  <HomeScheduleSourceScreen v-if="route.query.from === 'home'" />
  <ScheduleScreen v-else />
</template>
