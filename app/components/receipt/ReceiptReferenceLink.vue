<script setup lang="ts">
import type { DataOriginDTO, EntityRefDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ reference: EntityRefDTO, origin: DataOriginDTO, returnTo?: string }>()
const target = computed(() => resolveNavigationTarget({ kind: 'entity-detail', subject: props.reference, variant: 'detail', view: null, filters: { dataOrigin: props.origin, ...(props.reference.entity === 'contract' ? { contractKind: '施工' } : {}) } }, { returnTo: props.returnTo }))
</script>

<template>
  <NuxtLink v-if="target.state === 'resolved'" :to="target.to" class="cell--link break-words text-brand font-600 hover:underline">
    {{ target.label }}
  </NuxtLink>
  <span v-else class="text-ink-faint">{{ reference.state === 'forbidden' ? '无权限' : reference.state === 'resolved' ? reference.label : '未记录' }}</span>
</template>
