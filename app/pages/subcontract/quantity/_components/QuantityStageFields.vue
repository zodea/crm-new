<script setup lang="ts">
import type { QuantityStageDraft, QuantityStageWorkspace } from '~/lib/quantity/central-stages'
import { computed } from 'vue'

const props = defineProps<{
  draft: QuantityStageDraft
  items: Readonly<QuantityStageWorkspace['items']>
  readonly: boolean
}>()
const emit = defineEmits<{ patch: [value: Partial<QuantityStageDraft>] }>()
const availableItems = computed(() => props.items.filter(item => item.trade === props.draft.trade))
const trades = computed(() => [...new Set(props.items.map(item => item.trade))])

function changeText(key: 'code' | 'name' | 'trade', event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('patch', key === 'trade' ? { trade: value, itemIds: [] } : { [key]: value })
}
function changeMode(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('patch', { completionMode: value === 'manual' ? 'manual' : 'unit', itemIds: [] })
}
function changeItem(itemId: string, event: Event) {
  const selected = (event.target as HTMLInputElement).checked
  emit('patch', { itemIds: selected ? [...props.draft.itemIds, itemId] : props.draft.itemIds.filter(id => id !== itemId) })
}
function changeOrder(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('patch', { sortOrder: value.trim() ? Number(value) : Number.NaN })
}
</script>

<template>
  <fieldset :disabled="readonly" class="m-0 min-w-0 border-0 p-0">
    <section id="section-stage" class="scroll-mt-4">
      <h2 class="mb-3 mt-0 text-14px font-800 text-ink">
        阶段信息
      </h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          <span class="field-label">阶段编码 *</span>
          <input :value="draft.code" :readonly="Boolean(draft.id)" class="field-input w-full" aria-label="阶段编码" autocomplete="off" placeholder="如 PUTTY-01" @input="changeText('code', $event)">
        </label>
        <label>
          <span class="field-label">阶段名称 *</span>
          <input :value="draft.name" class="field-input w-full" aria-label="阶段名称" autocomplete="off" placeholder="如 第一遍腻子" @input="changeText('name', $event)">
        </label>
        <label>
          <span class="field-label">工种 *</span>
          <input :value="draft.trade" :readonly="Boolean(draft.id)" list="quantity-stage-trades" class="field-input w-full" aria-label="阶段工种" autocomplete="off" placeholder="选择或输入工种" @input="changeText('trade', $event)">
          <datalist id="quantity-stage-trades"><option v-for="trade in trades" :key="trade" :value="trade" /></datalist>
        </label>
        <label>
          <span class="field-label">完成方式 *</span>
          <select :value="draft.completionMode" :disabled="Boolean(draft.id)" class="field-input w-full" aria-label="完成方式" @change="changeMode">
            <option value="unit">逐户登记阶段完成</option>
            <option value="manual">排程中手动填写进度</option>
          </select>
        </label>
        <label>
          <span class="field-label">显示顺序</span>
          <input :value="Number.isFinite(draft.sortOrder) ? draft.sortOrder : ''" type="number" step="1" class="field-input w-full" aria-label="阶段显示顺序" @input="changeOrder">
        </label>
      </div>
      <p v-if="draft.id" class="mb-0 mt-2 text-12px text-ink-soft">
        编码、工种和完成方式保留原身份；需要不同阶段时请新建。
      </p>
    </section>

    <section id="section-items" class="mt-5 scroll-mt-4">
      <h2 class="mb-2 mt-0 text-14px font-800 text-ink">
        关联计量分项
      </h2>
      <p class="mb-3 mt-0 text-12px leading-6 text-ink-soft">
        关联决定哪些户适用这个阶段。新关联默认不参与月度报量，请在下方单独指定报量阶段。
      </p>
      <p v-if="draft.completionMode === 'manual'" class="m-0 rounded-[var(--radius-control)] bg-surface-2 p-3 text-12px text-ink-soft">
        手动进度阶段不关联计量分项，在排程中填写进度。
      </p>
      <div v-else-if="availableItems.length" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label v-for="item in availableItems" :key="item.id" class="min-w-0 flex items-start gap-2 rounded-[var(--radius-control)] border border-line p-3">
          <input type="checkbox" :checked="draft.itemIds.includes(item.id)" :aria-label="`关联${item.name}`" class="mt-1 accent-brand" @change="changeItem(item.id, $event)">
          <span class="min-w-0 text-12px leading-5"><span class="font-700 text-ink">{{ item.name }}</span><span class="ml-2 text-ink-soft">{{ item.code }} · {{ item.unit || '单位未填写' }}</span></span>
        </label>
      </div>
      <p v-else class="m-0 rounded-[var(--radius-control)] bg-surface-2 p-3 text-12px text-ink-soft">
        当前工种没有可关联分项。请先在户型模板中建立分项，再回来选择。
      </p>
    </section>
  </fieldset>
</template>
