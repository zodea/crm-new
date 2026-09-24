<script setup lang="ts">
import type { EntityRefDTO, NavigationIntentDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{
  reference: EntityRefDTO
  navigation: NavigationIntentDTO
}>()
const resolution = computed(() => resolveNavigationTarget(props.navigation))
</script>

<template>
  <NuxtLink
    v-if="resolution.state === 'resolved'"
    :to="resolution.to"
    class="cell--link block max-w-full truncate"
    :title="resolution.label"
  >
    {{ resolution.label }}
  </NuxtLink>
  <span v-else :data-target-state="resolution.state" :title="resolution.message" class="text-ink-faint">
    {{ reference.state === 'forbidden' ? '无权限' : reference.state === 'missing' ? '未记录' : reference.label }}
  </span>
</template>
