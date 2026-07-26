<script setup lang="ts">
import type { SupplierFormDraft } from '~/lib/master-data/forms'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'

const props = defineProps<{
  fieldErrors: Record<string, string>
}>()

const emit = defineEmits<{
  clearError: [field: keyof SupplierFormDraft]
}>()

const draft = defineModel<SupplierFormDraft>({ required: true })

const aliasesText = computed({
  get: () => draft.value.aliases?.join('、') ?? '',
  set: (value: string) => {
    draft.value.aliases = value
      .split(/[，,、;；]/)
      .map(item => item.trim())
      .filter(Boolean)
  },
})

function fieldClass(field: keyof SupplierFormDraft) {
  return props.fieldErrors[field]
    ? 'field-input w-full border-danger! ring-1 ring-danger/20'
    : 'field-input w-full'
}
</script>

<template>
  <section id="section-basic" class="panel scroll-mt-4 p-4">
    <SectionHeader title="基础信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">公司全称 *</span>
        <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="emit('clearError', 'name')">
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">简称/别名</span>
        <input v-model="aliasesText" class="field-input w-full" placeholder="多个别名用逗号或顿号分隔">
      </label>
      <label class="field-block">
        <span class="field-label">分供方类别 *</span>
        <select v-model="draft.supplierCategory" :class="fieldClass('supplierCategory')" data-field="supplierCategory" @change="emit('clearError', 'supplierCategory')">
          <option value="">
            请选择
          </option>
          <option v-for="category in SUPPLIER_CATEGORIES" :key="category" :value="category">
            {{ category }}
          </option>
        </select>
        <span v-if="fieldErrors.supplierCategory" class="field-error">{{ fieldErrors.supplierCategory }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">经营类型</span>
        <input v-model="draft.businessType" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">唯一识别码</span>
        <input v-model="draft.uniqueCode" class="field-input w-full font-mono">
      </label>
      <label class="field-block">
        <span class="field-label">统一社会信用代码</span>
        <input v-model="draft.taxNo" class="field-input w-full font-mono">
      </label>
      <label class="field-block">
        <span class="field-label">法定代表人</span>
        <input v-model="draft.legalRep" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">注册资金（万元）</span>
        <input v-model.number="draft.registeredCapital" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">注册日期</span>
        <input v-model="draft.registeredDate" type="date" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">纳税人类型</span>
        <select v-model="draft.taxpayerType" class="field-input w-full">
          <option value="未核验">
            未核验
          </option>
          <option value="一般纳税人">
            一般纳税人
          </option>
          <option value="小规模纳税人">
            小规模纳税人
          </option>
        </select>
      </label>
      <label class="field-block">
        <span class="field-label">评价等级</span>
        <input v-model="draft.rating" class="field-input w-full">
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">注册地址</span>
        <input v-model="draft.address" class="field-input w-full">
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">主营业务</span>
        <textarea v-model="draft.mainBusiness" rows="3" class="field-input w-full" />
      </label>
    </div>
  </section>

  <section id="section-contact" class="panel scroll-mt-4 p-4">
    <SectionHeader title="联系人信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">主要联系人 *</span>
        <input v-model="draft.contact" :class="fieldClass('contact')" data-field="contact" @input="emit('clearError', 'contact')">
        <span v-if="fieldErrors.contact" class="field-error">{{ fieldErrors.contact }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">联系人电话</span>
        <input v-model="draft.contactPhone" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">职务</span>
        <input v-model="draft.contactTitle" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">公司电话</span>
        <input v-model="draft.phone" class="field-input w-full">
      </label>
    </div>
  </section>

  <section id="section-invoice" class="panel scroll-mt-4 p-4">
    <SectionHeader title="开票与银行信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">开票名称</span>
        <input v-model="draft.invoiceName" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">开户行</span>
        <input v-model="draft.bank" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">银行账号</span>
        <input v-model="draft.bankAccount" class="field-input w-full font-mono">
      </label>
      <label class="field-block">
        <span class="field-label">开票地址</span>
        <input v-model="draft.invoiceAddress" class="field-input w-full">
      </label>
    </div>
  </section>
</template>
