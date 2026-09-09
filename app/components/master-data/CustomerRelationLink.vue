<script setup lang="ts">
import type { EntityRefDTO, NavigationIntentDTO } from '~/types/read-model'
import { computed, inject } from 'vue'
import {
  CUSTOMER_RETURN_CONTEXT_TTL,
  customerProjectReturnTo,
  newCustomerReturnContextId,
  saveCustomerProjectReturnOrigin,
} from '~/lib/customer/return-context'
import { KIT_TABLE_VIEW_KEY } from '~/lib/kit/table-view'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{
  reference: EntityRefDTO
  navigation: NavigationIntentDTO
  returnTo?: string
  returnContext?: string
  returnAnchor?: string | null
}>()
const tableView = inject(KIT_TABLE_VIEW_KEY, null)
const anchorId = computed(() => props.returnAnchor !== undefined
  ? props.returnAnchor
  : props.reference.state === 'resolved' ? `project:${encodeURIComponent(props.reference.id)}` : null)
const contextId = newCustomerReturnContextId()
const projectReturnTo = computed(() => props.reference.entity === 'project' && props.reference.state === 'resolved'
  ? customerProjectReturnTo(props.returnTo, contextId)
  : null)
const resolution = computed(() => resolveNavigationTarget(props.navigation, {
  returnTo: projectReturnTo.value ?? props.returnTo,
  returnContextId: props.returnContext,
}))

function capture() {
  if (!projectReturnTo.value || props.reference.state !== 'resolved')
    return
  saveCustomerProjectReturnOrigin({
    returnTo: projectReturnTo.value,
    projectId: props.reference.id,
    anchorId: anchorId.value,
    scrollTop: document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0,
    scrollLeft: tableView?.scrollLeft() ?? 0,
    expiresAt: Date.now() + CUSTOMER_RETURN_CONTEXT_TTL,
  })
}
</script>

<template>
  <NuxtLink
    v-if="resolution.state === 'resolved'"
    :to="resolution.to"
    class="cell--link block max-w-full truncate"
    :title="resolution.label"
    :data-customer-project-id="projectReturnTo ? reference.id : undefined"
    :data-customer-relation-anchor="projectReturnTo ? anchorId : undefined"
    @click="capture"
  >
    {{ resolution.label }}
  </NuxtLink>
  <span v-else :data-target-state="resolution.state" :title="resolution.message" class="text-ink-faint">
    {{ reference.state === 'forbidden' ? '无权限' : reference.state === 'missing' ? '未记录' : reference.label }}
  </span>
</template>
