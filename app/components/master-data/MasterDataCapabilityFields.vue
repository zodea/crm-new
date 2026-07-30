<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { normalizeCapabilityList } from '~/lib/master-data/capabilities'

const props = withDefaults(defineProps<{
  primaryTrade?: string
}>(), {
  primaryTrade: '',
})

const tradeCapabilities = defineModel<string[] | undefined>('trades', { default: () => [] })
const itemCapabilities = defineModel<string[] | undefined>('items', { default: () => [] })
const tradeInput = shallowRef('')
const itemInput = shallowRef('')

const normalizedPrimaryTrade = computed(() => props.primaryTrade.trim())
const visibleTrades = computed(() => normalizeCapabilityList([
  normalizedPrimaryTrade.value,
  ...(tradeCapabilities.value ?? []),
]))

function appendCapability(
  input: string,
  current: readonly string[],
  update: (values: string[]) => void,
) {
  const values = normalizeCapabilityList([
    ...current,
    ...input.split(/[，,\n]/),
  ])
  update(values)
}

function addTrade() {
  appendCapability(tradeInput.value, tradeCapabilities.value ?? [], (values) => {
    tradeCapabilities.value = values.filter(value => value !== normalizedPrimaryTrade.value)
  })
  tradeInput.value = ''
}

function addItem() {
  appendCapability(itemInput.value, itemCapabilities.value ?? [], (values) => {
    itemCapabilities.value = values
  })
  itemInput.value = ''
}

function removeTrade(value: string) {
  tradeCapabilities.value = (tradeCapabilities.value ?? []).filter(item => item !== value)
}

function removeItem(value: string) {
  itemCapabilities.value = (itemCapabilities.value ?? []).filter(item => item !== value)
}
</script>

<template>
  <div class="form-span-full grid gap-4 border border-line rounded-[var(--radius-card)] bg-surface-2 p-3" data-testid="master-data-capabilities">
    <div>
      <h3 class="text-13px font-800 text-ink">
        可承接能力
      </h3>
      <p class="mt-1 text-11px leading-relaxed text-ink-soft">
        主工种自动纳入能力；工程量责任配置只会列出与所选工种、活项兼容的班组或工人。
      </p>
    </div>

    <div class="grid gap-2">
      <label class="field-label" for="capability-trade-input">兼任工种</label>
      <div class="flex min-w-0 gap-2">
        <input
          id="capability-trade-input"
          v-model="tradeInput"
          class="field-input min-w-0 flex-1"
          placeholder="例如：防水工；可用逗号批量添加"
          @keydown.enter.prevent="addTrade"
        >
        <button type="button" class="btn-secondary flex-none" @click="addTrade">
          添加工种
        </button>
      </div>
      <div v-if="visibleTrades.length" class="flex flex-wrap gap-2" aria-label="已配置工种能力">
        <span
          v-for="trade in visibleTrades"
          :key="trade"
          class="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-11px font-700 text-brand-deep"
        >
          {{ trade }}
          <span v-if="trade === normalizedPrimaryTrade" class="font-500 text-brand">主工种</span>
          <button
            v-else
            type="button"
            class="i-lucide-x h-3.5 w-3.5 text-brand hover:text-danger"
            :aria-label="`移除工种能力${trade}`"
            @click="removeTrade(trade)"
          />
        </span>
      </div>
    </div>

    <div class="grid gap-2">
      <label class="field-label" for="capability-item-input">限定可做活项（可选）</label>
      <div class="flex min-w-0 gap-2">
        <input
          id="capability-item-input"
          v-model="itemInput"
          class="field-input min-w-0 flex-1"
          placeholder="例如：墙砖铺贴、地砖铺贴；留空表示可做能力工种下全部活项"
          @keydown.enter.prevent="addItem"
        >
        <button type="button" class="btn-secondary flex-none" @click="addItem">
          添加活项
        </button>
      </div>
      <div v-if="itemCapabilities?.length" class="flex flex-wrap gap-2" aria-label="已配置活项能力">
        <span
          v-for="itemName in itemCapabilities"
          :key="itemName"
          class="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-11px font-700 text-ink ring-1 ring-line"
        >
          {{ itemName }}
          <button
            type="button"
            class="i-lucide-x h-3.5 w-3.5 text-ink-faint hover:text-danger"
            :aria-label="`移除活项能力${itemName}`"
            @click="removeItem(itemName)"
          />
        </span>
      </div>
      <p v-else class="text-11px text-ink-faint">
        未限定活项：可承接上述工种下的全部活项。
      </p>
    </div>
  </div>
</template>
