<script setup lang="ts">
import type { EntityRefDTO, NavigationIntentDTO } from '~/types/read-model'
import { computed, inject } from 'vue'
import {
  CUSTOMER_RETURN_CONTEXT_TTL,
  customerRelationReturnTo,
  newCustomerReturnContextId,
  saveCustomerRelationReturnOrigin,
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
  : props.reference.state === 'resolved' ? `${props.reference.entity}:${encodeURIComponent(props.reference.id)}` : null)
const contextId = newCustomerReturnContextId()
const relationReturnTo = computed(() => ['project', 'contract', 'receipt'].includes(props.reference.entity) && props.reference.state === 'resolved'
  ? customerRelationReturnTo(props.returnTo, contextId)
  : null)
const resolution = computed(() => resolveNavigationTarget(props.navigation, {
  returnTo: relationReturnTo.value ?? props.returnTo,
  returnContextId: props.returnContext,
}))

function capture() {
  if (!relationReturnTo.value || props.reference.state !== 'resolved'
    || (props.reference.entity !== 'project' && props.reference.entity !== 'contract' && props.reference.entity !== 'receipt')) {
    return
  }
  saveCustomerRelationReturnOrigin({
    returnTo: relationReturnTo.value,
    targetEntity: props.reference.entity,
    targetId: props.reference.id,
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
    :data-customer-project-id="relationReturnTo && reference.entity === 'project' ? reference.id : undefined"
    :data-customer-target-id="relationReturnTo ? reference.id : undefined"
    :data-customer-target-entity="relationReturnTo ? reference.entity : undefined"
    :data-customer-relation-anchor="relationReturnTo ? anchorId : undefined"
    @click="capture"
  >
    {{ resolution.label }}
  </NuxtLink>
  <span v-else :data-target-state="resolution.state" :title="resolution.message" class="text-ink-faint">
    {{ reference.state === 'forbidden' ? '无权限' : reference.state === 'missing' ? '未记录' : reference.label }}
  </span>
</template>
