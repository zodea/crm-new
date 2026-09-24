<script setup lang="ts">
import type { PayrollAFeeConfigRead, PayrollAFeeDraft, PayrollAFeeValues } from '~/lib/payroll/central-a-fees-contract'
import { computed, shallowRef } from 'vue'
import { payrollInputNumber } from '~/lib/payroll/a-presentation'
import PayrollAFeeBasisEditor from './PayrollAFeeBasisEditor.vue'

const props = defineProps<{
  draft: PayrollAFeeDraft
  read: PayrollAFeeConfigRead
  returnTo?: string
  disabled: boolean
}>()
const emit = defineEmits<{
  change: [
        value: PayrollAFeeDraft,
  ]
  remove: [
  ]
}>()
const classificationNote = shallowRef('')
const management = computed(() => props.draft.bookPurpose === 'management')
const defaults = computed(() => props.read.crewDefaults)
const defaultEnabled = computed(() => management.value ? defaults.value?.managementEnabled : defaults.value?.rentEnabled)
const defaultPrice = computed(() => management.value ? defaults.value?.managementUnitPrice : defaults.value?.rentUnitPrice)
const defaultEnabledLabel = computed(() => defaultEnabled.value?.state === 'value' ? defaultEnabled.value.value ? '已启用' : '已关闭' : defaultEnabled.value?.state === 'null' ? '未填写' : '未记录')
const defaultPriceLabel = computed(() => defaultPrice.value?.state === 'value' ? `明确 ${defaultPrice.value.value.toFixed(2)} 元` : defaultPrice.value?.state === 'null' ? '未填写' : '未记录')
const canAdoptCrew = computed(() => !!defaults.value && defaultEnabled.value?.state === 'value' && defaultPrice.value?.state === 'value')
const canAdoptHousing = computed(() => props.draft.kind === 'housing' && props.draft.basis.itemIds.length > 0 && props.draft.basis.itemIds.every(id => props.read.items.some(item => item.itemId === id && item.unit === '㎡')) && !!classificationNote.value.trim())
function change(patch: Partial<PayrollAFeeValues>) {
  emit('change', { ...props.draft, ...patch })
}
function adoptCrew() {
  if (props.disabled || !defaults.value || defaultEnabled.value?.state !== 'value' || defaultPrice.value?.state !== 'value')
    return
  change({ enabled: defaultEnabled.value.value, unitPrice: defaultPrice.value.value, adoptedDefault: { kind: management.value ? 'crew-management' : 'crew-rent', fact: defaults.value } })
}
function adoptHousing() {
  if (props.disabled || !canAdoptHousing.value)
    return
  change({ enabled: true, unit: '㎡', unitPrice: 1.3, adoptedDefault: { kind: 'confirmed-housing-items', itemIds: [...props.draft.basis.itemIds], unitPrice: 1.3, unit: '㎡', evidenceNote: classificationNote.value.trim() } })
}
</script>

<template>
  <article class="grid grid-cols-1 min-w-0 gap-3 rounded border border-line p-3" aria-label="费用配置行">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-13px font-700">
        {{ draft.feeId ? '修订费用' : '新增费用' }}
      </p><KitButton type="button" variant="ghost" :disabled="disabled" @click="emit('remove')">
        {{ draft.feeId ? '移除此费用（追加修订）' : '移除未保存项' }}
      </KitButton>
    </div>
    <div class="grid grid-cols-1 min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">名称<input class="field-input min-w-0 w-full" :value="draft.name" aria-label="费用名称" :disabled="disabled" @input="change({ name: ($event.target as HTMLInputElement).value })"></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">费用类别<select class="field-input min-w-0 w-full" :value="draft.kind" aria-label="费用类别" :disabled="disabled || !!draft.feeId || management" @change="emit('change', { ...draft, bookPurpose: 'ordinary', managementBookId: null, kind: ($event.target as HTMLSelectElement).value === 'housing' ? 'housing' : 'subsidy', adoptedDefault: null })"><option v-if="management" value="management">管理费</option><template v-else><option value="housing">房补</option><option value="subsidy">其他补贴</option></template></select></label>
      <label class="flex items-center gap-2 text-12px"><input type="checkbox" :checked="draft.enabled" aria-label="启用此费用" :disabled="disabled" @change="change({ enabled: ($event.target as HTMLInputElement).checked })">启用此费用</label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">单价<input class="field-input min-w-0 w-full" type="number" min="0" step="any" :value="draft.unitPrice ?? ''" aria-label="费用单价" :disabled="disabled" @input="change({ unitPrice: payrollInputNumber(($event.target as HTMLInputElement).value), adoptedDefault: null })"></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">计量单位<input class="field-input min-w-0 w-full" :value="draft.unit ?? ''" aria-label="费用单位" :disabled="disabled" @input="change({ unit: ($event.target as HTMLInputElement).value || null, adoptedDefault: null })"></label>
      <label class="grid grid-cols-1 min-w-0 gap-1 text-12px">生效月份<input class="field-input min-w-0 w-full" type="month" :value="draft.effectiveMonth" aria-label="费用生效月份" :disabled="disabled" @input="change({ effectiveMonth: ($event.target as HTMLInputElement).value })"></label>
    </div>
    <PayrollAFeeBasisEditor :basis="draft.basis" :read="read" :return-to="returnTo" :disabled="disabled" @change="change({ basis: $event, adoptedDefault: null })" />
    <section v-if="draft.kind !== 'subsidy'" class="grid grid-cols-1 min-w-0 gap-2 rounded bg-surface-2 p-3 text-12px leading-5" aria-label="班组费用默认事实">
      <p>班组默认仅供明确采用。{{ canAdoptCrew ? '已记录明确开关和金额。' : '开关或金额未完整记录，不能作为已配置事实。' }}</p>
      <div class="flex flex-wrap gap-x-6 gap-y-1">
        <p>开关：{{ defaultEnabledLabel }}</p>
        <p>单价：{{ defaultPriceLabel }}</p>
      </div>
      <KitButton class="justify-self-start" type="button" variant="secondary" :disabled="disabled || !canAdoptCrew" @click="adoptCrew">
        {{ management ? '采用班组管理费默认' : '采用班组房补默认' }}
      </KitButton>
      <template v-if="draft.kind === 'housing'">
        <label class="grid grid-cols-1 min-w-0 gap-1">所选房补分项的确认依据<textarea v-model="classificationNote" class="field-input min-w-0 w-full" rows="2" aria-label="房补分类确认依据" :disabled="disabled" /></label>
        <KitButton class="justify-self-start" type="button" variant="secondary" :disabled="disabled || !canAdoptHousing" @click="adoptHousing">
          确认所选房补分项并采用 1.30 元/㎡
        </KitButton>
      </template>
      <p v-if="draft.adoptedDefault">
        已明确采用建议；仍须保存当前项目修订。后续班组默认变化不会改写已采用配置。
      </p>
    </section>
  </article>
</template>
