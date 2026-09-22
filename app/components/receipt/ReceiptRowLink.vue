<script setup lang="ts">
import type { ReceiptDetail } from '~/lib/receipt/contract'
import { computed, inject } from 'vue'
import { KIT_TABLE_VIEW_KEY } from '~/lib/kit/table-view'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { receiptListReturnTo, saveReceiptListOrigin } from '~/lib/receipt/return-context'

const props = defineProps<{ detail: ReceiptDetail, source: string, contextId: string }>()
const table = inject(KIT_TABLE_VIEW_KEY, null)
const anchor = computed(() => `receipt-${props.detail.record.dataOrigin}-${props.detail.record.id}`)
const returnTo = computed(() => receiptListReturnTo(props.source, props.detail.record.id, props.detail.record.dataOrigin, props.contextId))
const target = computed(() => resolveNavigationTarget({ kind: 'entity-detail', subject: { state: 'resolved', entity: 'receipt', id: props.detail.record.id, label: props.detail.record.draft.no || '未编号收款', no: props.detail.record.draft.no || null }, variant: 'detail', view: null, filters: { dataOrigin: props.detail.record.dataOrigin } }, { returnTo: returnTo.value }))
function capture() {
  saveReceiptListOrigin({ returnTo: returnTo.value, scrollLeft: table?.scrollLeft() ?? 0, scrollTop: document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0 })
}
</script>

<template>
  <NuxtLink v-if="target.state === 'resolved'" :id="anchor" :to="target.to" class="cell--link block truncate" @click="capture">
    {{ target.label }}
  </NuxtLink>
  <span v-else>详情暂不可用</span>
</template>
