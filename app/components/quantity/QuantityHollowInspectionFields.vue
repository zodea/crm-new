<script setup lang="ts">
import type { QuantityHollowFields } from '~/composables/useQuantityHollowForm'
import type { QuantityHollowRead, QuantityHollowRecord } from '~/lib/quantity/central-hollow-contract'
import { computed } from 'vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'

const props = defineProps<{ read: QuantityHollowRead, record: QuantityHollowRecord | null, mode: 'create' | 'revise' | 'rectify', fields: QuantityHollowFields, disabled: boolean, errors: Record<string, string> }>()
const emit = defineEmits<{ patch: [patch: Partial<QuantityHollowFields>] }>()
const selected = computed(() => props.read.data.targets.find(target => JSON.stringify(target.target) === props.fields.target))
const targetOptions = computed(() => props.read.data.targets.map(target => ({ key: JSON.stringify(target.target), label: `${target.location.locationLabel} · 原${target.originalParty.kind === 'worker' ? '施工人' : '班组'} ${target.originalPartyName}`, allowed: target.create.allowed })))
function patch(key: keyof QuantityHollowFields, event: Event) {
  emit('patch', { [key]: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <section v-if="mode !== 'rectify'" id="section-responsibility" class="panel grid min-w-0 gap-3 p-4" aria-label="空鼓原位置与责任">
    <SectionHeader title="原位置与施工责任" :mb="0" />
    <label v-if="mode === 'create'" class="grid min-w-0 gap-2 text-12px">检查范围<select class="field-input min-w-0 w-full" aria-label="空鼓检查范围" :value="fields.target" :disabled="disabled" :aria-invalid="!!errors.target" @change="patch('target', $event)">
      <option value="">请选择原户分项与责任</option>
      <option v-for="target in targetOptions" :key="target.key" :value="target.key" :disabled="!target.allowed">{{ target.label }}</option>
    </select></label>
    <p v-if="record" class="break-words text-12px leading-5">
      {{ record.location.locationLabel }} · 原责任 {{ record.originalPartyName }}。本次修订保留此原身份。
    </p><p v-else-if="selected" class="break-words text-12px leading-5">
      {{ selected.location.locationLabel }} · 原责任 {{ selected.originalPartyName }}
    </p><p v-if="errors.target" class="text-12px text-danger">
      {{ errors.target }}
    </p>
  </section>
  <section id="section-inspection" class="panel grid min-w-0 gap-4 p-4" :aria-label="mode === 'rectify' ? '本次整改销记' : '空鼓检查内容'">
    <SectionHeader :title="mode === 'rectify' ? '本次整改销记' : '检查内容'" :mb="0" />
    <div class="grid min-w-0 gap-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-2 text-12px">{{ mode === 'rectify' ? '整改日期' : '检查日期' }}<input type="date" class="field-input min-w-0 w-full" :aria-label="mode === 'rectify' ? '整改日期' : '检查日期'" :value="mode === 'rectify' ? fields.rectifiedOn : fields.inspectedOn" :disabled="disabled" :aria-invalid="!!errors[mode === 'rectify' ? 'rectifiedOn' : 'inspectedOn']" @input="patch(mode === 'rectify' ? 'rectifiedOn' : 'inspectedOn', $event)"><span v-if="errors.inspectedOn || errors.rectifiedOn" class="text-danger">{{ errors.inspectedOn || errors.rectifiedOn }}</span></label>
      <label class="grid min-w-0 gap-2 text-12px">{{ mode === 'rectify' ? '本次整改处数' : '检查发现总处数' }}<input type="number" step="1" :min="mode === 'rectify' ? 1 : 0" class="field-input min-w-0 w-full" :aria-label="mode === 'rectify' ? '本次整改处数' : '检查发现总处数'" :value="fields.count" :disabled="disabled" :aria-invalid="!!errors.count" @input="patch('count', $event)"><span v-if="errors.count" class="text-danger">{{ errors.count }}</span></label>
    </div><p class="text-12px leading-5 text-ink-soft">
      {{ mode === 'rectify' ? `当前未整改 ${record?.remainingCount ?? '未知'} 处。本次销记不得超过原记录余量，原检查不会删除。` : '按处记录整数。没有检查记录与明确检查为零不同；请按真实检查填写，空值不会作为零提交。' }}
    </p>
  </section>
  <section id="section-evidence" class="panel grid min-w-0 gap-4 p-4" aria-label="检查整改说明">
    <label v-if="mode === 'revise'" class="grid min-w-0 gap-2 text-12px">修订原因<textarea class="field-input min-w-0 w-full" rows="3" aria-label="检查修订原因" :value="fields.reason" :disabled="disabled" :aria-invalid="!!errors.reason" @input="patch('reason', $event)" /><span v-if="errors.reason" class="text-danger">{{ errors.reason }}</span></label>
    <label class="grid min-w-0 gap-2 text-12px">{{ mode === 'rectify' ? '整改说明' : '检查说明' }}<textarea class="field-input min-w-0 w-full" rows="3" :aria-label="mode === 'rectify' ? '整改说明' : '检查说明'" :value="fields.note" :disabled="disabled" :aria-invalid="!!errors.note" @input="patch('note', $event)" /><span v-if="errors.note" class="text-danger">{{ errors.note }}</span></label>
  </section>
</template>
