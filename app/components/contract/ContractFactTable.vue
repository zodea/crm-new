<script setup lang="ts">
import type { Directive } from 'vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { NavigationIntentDTO } from '~/types/read-model'
import { computed, nextTick } from 'vue'
import KitTable from '~/components/ui/KitTable.vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { yuan } from '~/lib/util/money'

export interface ContractFactRow {
  id: string
  no: string | null
  name: string
  date: string | null
  amount: string | null
  paidAmount?: string | null
  status: string | null
  navigation: NavigationIntentDTO
}

const props = defineProps<{
  rows: readonly ContractFactRow[]
  emptyLabel: string
  paidColumn?: boolean
  focusId?: string | null
  anchorPrefix?: string
  returnTo?: string | null
  returnFocusView?: 'acceptance' | 'warranty'
}>()

const columns = computed<KitTableColumn[]>(() => [
  { field: 'no', title: '单号', width: 150, slot: 'no' },
  { field: 'name', title: '名称', minWidth: 200, slot: 'name' },
  { field: 'date', title: '日期', width: 120, slot: 'date' },
  { field: 'amount', title: '金额', width: 140, align: 'right', slot: 'amount' },
  ...(props.paidColumn ? [{ field: 'paidAmount', title: '已支付', width: 140, align: 'right', slot: 'paidAmount' } satisfies KitTableColumn] : []),
  { field: 'status', title: '状态', width: 120, slot: 'status' },
])

function target(row: ContractFactRow) {
  const result = resolveNavigationTarget(row.navigation, {
    returnTo: rowReturnTo(row) ?? undefined,
  })
  return result.state === 'resolved' ? result.to : null
}

function rowReturnTo(row: ContractFactRow): string | null {
  if (!props.returnTo)
    return null
  if (!props.returnFocusView)
    return props.returnTo
  try {
    const url = new URL(props.returnTo, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid')
      return props.returnTo
    url.searchParams.set('focus', row.id)
    url.searchParams.set('focusView', props.returnFocusView)
    url.hash = anchorId(row) ?? ''
    return `${url.pathname}?${url.searchParams.toString()}${url.hash}`
  }
  catch {
    return props.returnTo
  }
}

function anchorId(row: ContractFactRow) {
  return props.anchorPrefix ? `${props.anchorPrefix}-${row.id}` : undefined
}

function focusElement(element: HTMLElement) {
  void nextTick(() => element.focus({ preventScroll: false }))
}

const vFocusTarget: Directive<HTMLElement, boolean> = {
  mounted(element, binding) {
    if (binding.value)
      focusElement(element)
  },
  updated(element, binding) {
    if (binding.value && !binding.oldValue)
      focusElement(element)
  },
}
</script>

<template>
  <KitTable
    :columns="columns"
    :data="[...rows]"
    :min-rows="5"
    row-key="id"
    :empty="{ title: emptyLabel }"
  >
    <template #no="{ row }">
      <span class="font-mono">{{ row.no || '—' }}</span>
    </template>
    <template #name="{ row }">
      <NuxtLink
        v-if="target(row)"
        :id="anchorId(row)"
        v-focus-target="focusId === row.id"
        :to="target(row)!"
        :tabindex="focusId === row.id ? -1 : undefined"
        class="font-700 text-brand hover:underline"
        :class="focusId === row.id ? 'rounded bg-brand-soft/60 px-1' : ''"
      >
        {{ row.name || row.no || '查看来源' }}
      </NuxtLink>
      <span v-else :id="anchorId(row)" v-focus-target="focusId === row.id" :tabindex="focusId === row.id ? -1 : undefined">{{ row.name || '—' }}</span>
    </template>
    <template #date="{ row }">
      <span class="font-mono">{{ row.date || '—' }}</span>
    </template>
    <template #amount="{ row }">
      <span class="font-mono">{{ row.amount == null ? '—' : yuan(Number(row.amount)) }}</span>
    </template>
    <template #paidAmount="{ row }">
      <span class="font-mono">{{ yuan(Number(row.paidAmount ?? 0)) }}</span>
    </template>
    <template #status="{ row }">
      <span class="chip bg-surface-3 text-ink-soft">{{ row.status || '未记录' }}</span>
    </template>
  </KitTable>
</template>
