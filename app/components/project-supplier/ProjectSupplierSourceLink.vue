<script setup lang="ts">
import type { NavigationIntentDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{
  intent: NavigationIntentDTO
  returnTo: string
  label: string
}>()

const target = computed(() => resolveNavigationTarget(props.intent, { returnTo: props.returnTo }))
</script>

<template>
  <NuxtLink v-if="target.state === 'resolved'" :to="target.to" class="cell--link" :title="`打开${target.label}`">
    {{ label }}
  </NuxtLink>
  <span v-else class="text-ink-faint" :title="target.message">{{ target.message }}</span>
</template>
