<script setup lang="ts">
import type { NavigationIntentDTO } from '~/types/read-model'
import { computed, inject } from 'vue'
import { KIT_TABLE_VIEW_KEY } from '~/lib/kit/table-view'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { saveReceiptSourceOrigin, validateReceiptReturnTo } from '~/lib/receipt/return-context'
import { isDataOriginDTO } from '~/types/read-model'

const props = defineProps<{ intent: NavigationIntentDTO, returnTo: string, anchorId: string, label: string }>()
const table = inject(KIT_TABLE_VIEW_KEY, null)
const source = computed(() => {
  const origin = 'filters' in props.intent ? props.intent.filters.dataOrigin : null
  if (!isDataOriginDTO(origin))
    return null
  const url = new URL(props.returnTo, 'https://ruihang.invalid')
  url.hash = encodeURIComponent(props.anchorId)
  return validateReceiptReturnTo(`${url.pathname}${url.search}${url.hash}`, origin)
})
const target = computed(() => resolveNavigationTarget(props.intent, { returnTo: source.value ?? props.returnTo }))
function capture(event: MouseEvent) {
  if (!source.value)
    return
  const scroll = (event.currentTarget as HTMLElement)?.closest<HTMLElement>('[data-testid="final-settlement-source-scroll"]')
  saveReceiptSourceOrigin({ returnTo: source.value, scrollTop: document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0, scrollLeft: table?.scrollLeft() ?? scroll?.scrollLeft ?? 0 })
}
</script>

<template>
  <NuxtLink v-if="target.state === 'resolved'" :id="anchorId" :to="target.to" class="cell--link" @click="capture">
    {{ label }}
  </NuxtLink><span v-else class="text-ink-faint">{{ target.message }}</span>
</template>
