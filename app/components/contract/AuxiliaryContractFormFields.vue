<script setup lang="ts">
import type { AuxiliaryContractDraft } from '~/lib/auxiliary-contract/contract'
import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type { LookupOption } from '~/lib/kit/lookup'
import { AUXILIARY_CATEGORIES } from '~/lib/auxiliary-contract/contract'

const props = defineProps<{ draft: AuxiliaryContractDraft, errors: Record<string, string>, fetchProjects: (keyword: string) => Promise<LookupOption[]>, fetchSuppliers: (keyword: string) => Promise<LookupOption[]>, fetchMains: (keyword: string) => Promise<LookupOption[]>, fetchSignatories: (keyword: string) => Promise<LookupOption[]>, constructionMain: ConstructionMainSelection | null, usesConstructionMain: boolean }>()
const emit = defineEmits<{ patch: [patch: Partial<AuxiliaryContractDraft>], selectMain: [id: string | null], selectSignatory: [id: string | null] }>()
const categories = computed(() => AUXILIARY_CATEGORIES[props.draft.kind].map(value => ({ key: value, label: value })))
const fields = computed(() => [
  { key: 'no', label: '合同编号' },
  { key: 'name', label: '合同名称 *' },
  ...(props.draft.kind === 'company_expense' ? [{ key: 'counterparty', label: '对方单位 *' }] : []),
  { key: 'signDate', label: '签订日期 *', type: 'date' },
  { key: 'servicePeriod', label: '租期或服务期' },
  ...(props.draft.kind === 'other_expense' ? [{ key: 'contactName', label: '履约联系人' }, { key: 'contactPhone', label: '联系方式' }] : []),
] as Array<{ key: keyof AuxiliaryContractDraft, label: string, type?: string }>)
function input(key: keyof AuxiliaryContractDraft, event: Event) {
  emit('patch', { [key]: (event.target as HTMLInputElement).value })
}
function number(key: 'amount' | 'taxRate', event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('patch', { [key]: value === '' ? null : Number(value) })
}
</script>

<template>
  <section id="section-basic" class="panel p-4">
    <SectionHeader title="基本信息" />
    <div class="form-fields-grid">
      <div class="field-block form-span-full">
        <label class="field-label" for="aux-our-signatory">甲方（我方）</label>
        <LookupSelect field="aux-our-signatory" :model-value="draft.ourSignatoryId ?? null" :fetch="fetchSignatories" :invalid="Boolean(errors.ourSignatoryId)" placeholder="搜索真实签约主体" @update:model-value="emit('selectSignatory', $event)" />
        <p v-if="draft.ourSignatorySnapshot" class="m-0 text-12px text-ink-soft">
          文书采用：{{ draft.ourSignatorySnapshot.name }} · 核实版本 {{ draft.ourSignatorySnapshot.version }}
        </p>
        <p v-else-if="draft.partyA" class="m-0 text-12px text-ink-soft">
          历史原文：{{ draft.partyA }}；尚未映射真实主体。
        </p>
        <span v-if="errors.ourSignatoryId" class="field-error">{{ errors.ourSignatoryId }}</span>
      </div>
      <label v-for="field in fields" :key="field.key" class="field-block"><span class="field-label">{{ field.label }}</span><input :value="draft[field.key] ?? ''" :type="field.type || 'text'" class="field-input w-full" :aria-invalid="Boolean(errors[field.key])" :aria-describedby="errors[field.key] ? `aux-error-${field.key}` : undefined" @input="input(field.key, $event)"><span v-if="errors[field.key]" :id="`aux-error-${field.key}`" class="field-error">{{ errors[field.key] }}</span></label>
      <div class="field-block">
        <span class="field-label">类别 *</span><SelectFilter :model-value="draft.category" :options="categories" aria-label="合同类别" full-width @update:model-value="emit('patch', { category: $event })" /><span v-if="errors.category" class="field-error">{{ errors.category }}</span>
      </div>
      <template v-if="draft.kind === 'other_expense'">
        <div v-if="!usesConstructionMain || (draft.id && !constructionMain)" class="field-block">
          <span class="field-label">{{ usesConstructionMain ? '历史项目' : '项目' }} *</span><LookupSelect :model-value="draft.projectId" :fetch="fetchProjects" :invalid="Boolean(errors.projectId)" placeholder="检索项目" @update:model-value="emit('patch', { projectId: $event })" /><span v-if="errors.projectId" class="field-error">{{ errors.projectId }}</span>
          <p v-if="usesConstructionMain" class="m-0 text-12px text-ink-soft">
            原工程关系保留；施工主合同在已有来源详情明确核实，不自动补关联。
          </p>
        </div>
        <div v-if="usesConstructionMain" class="field-block">
          <label class="field-label" for="aux-construction-main">工程名称 *</label><LookupSelect field="aux-construction-main" :model-value="constructionMain?.id ?? null" :fetch="fetchMains" :invalid="Boolean(errors.projectId || errors.constructionMain)" placeholder="搜索工程及施工主合同名称 / 编号" @update:model-value="emit('selectMain', $event)" /><span v-if="errors.projectId || errors.constructionMain" class="field-error">{{ errors.projectId || errors.constructionMain }}</span>
          <p v-if="draft.id && !constructionMain && draft.projectId" class="m-0 text-12px text-ink-soft">
            历史项目关系保留；未采用施工主合同，不自动补关联。
          </p>
        </div>
        <div class="field-block">
          <span class="field-label">乙方分供方 *</span><LookupSelect :model-value="draft.supplierId" :fetch="fetchSuppliers" :invalid="Boolean(errors.supplierId)" placeholder="检索分供方" @update:model-value="emit('patch', { supplierId: $event })" /><span v-if="errors.supplierId" class="field-error">{{ errors.supplierId }}</span>
        </div>
      </template>
    </div>
  </section>
  <section id="section-amount" class="panel p-4">
    <SectionHeader title="合同金额" />
    <div class="form-fields-grid">
      <label class="field-block"><span class="field-label">合同金额 *</span><input :value="draft.amount ?? ''" class="field-input w-full" type="number" min="0" step="0.01" :aria-invalid="Boolean(errors.amount)" @input="number('amount', $event)"><span v-if="errors.amount" class="field-error">{{ errors.amount }}</span></label>
      <label class="field-block"><span class="field-label">税率（%）</span><input :value="draft.taxRate ?? ''" class="field-input w-full" type="number" min="0" max="100" step="0.01" :aria-invalid="Boolean(errors.taxRate)" @input="number('taxRate', $event)"><span v-if="errors.taxRate" class="field-error">{{ errors.taxRate }}</span></label>
      <label class="field-block"><span class="field-label">发票类型</span><input :value="draft.invoiceType" class="field-input w-full" @input="input('invoiceType', $event)"></label>
      <div class="field-block">
        <span class="field-label">付款周期</span><SelectFilter :model-value="draft.paymentCycle" :options="['月', '季', '年', '一次性'].map(value => ({ key: value, label: value }))" aria-label="付款周期" full-width @update:model-value="emit('patch', { paymentCycle: $event })" />
      </div>
    </div>
  </section>
  <section id="section-terms" class="panel p-4">
    <SectionHeader title="合同条款" /><label v-if="draft.kind === 'other_expense'" class="field-block mt-3"><span class="field-label">合同内容简述</span><textarea :value="draft.content" rows="3" class="field-input w-full" @input="input('content', $event)" /></label><label class="field-block mt-3"><span class="field-label">主要条款</span><textarea :value="draft.mainTerms" rows="4" class="field-input w-full" @input="input('mainTerms', $event)" /></label><p class="text-12px text-ink-soft">
      合同状态：{{ draft.status || '草稿' }}。审批和结清结果由真实流程记录。
    </p>
  </section>
</template>
