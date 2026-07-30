<script setup lang="ts">
import type { CustomerFormDraft } from '~/lib/master-data/forms'

const props = defineProps<{
  fieldErrors: Record<string, string>
}>()

const emit = defineEmits<{
  clearError: [field: keyof CustomerFormDraft]
}>()

const draft = defineModel<CustomerFormDraft>({ required: true })

const aliasesText = computed({
  get: () => draft.value.aliases?.join('、') ?? '',
  set: (value: string) => {
    draft.value.aliases = value
      .split(/[，,、;；]/)
      .map(item => item.trim())
      .filter(Boolean)
  },
})

function fieldClass(field: keyof CustomerFormDraft) {
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
        <span class="field-label">客户名称 *</span>
        <input
          v-model="draft.name"
          name="customer-name"
          autocomplete="organization"
          :class="fieldClass('name')"
          data-field="name"
          @input="emit('clearError', 'name')"
        >
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">简称/别名</span>
        <input
          v-model="aliasesText"
          name="customer-aliases"
          autocomplete="off"
          class="field-input w-full"
          placeholder="多个别名用逗号或顿号分隔…"
        >
      </label>
      <label class="field-block">
        <span class="field-label">统一社会信用代码</span>
        <input
          v-model="draft.taxNo"
          name="customer-tax-no"
          autocomplete="off"
          spellcheck="false"
          class="field-input w-full font-mono"
        >
      </label>
      <label class="field-block">
        <span class="field-label">法定代表人</span>
        <input
          v-model="draft.legalRep"
          name="customer-legal-representative"
          autocomplete="off"
          class="field-input w-full"
        >
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">注册地址</span>
        <input
          v-model="draft.registeredAddress"
          name="customer-registered-address"
          autocomplete="street-address"
          class="field-input w-full"
        >
      </label>
    </div>
  </section>

  <section id="section-invoice" class="panel scroll-mt-4 p-4">
    <SectionHeader title="开票与银行" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">开票名称</span>
        <input
          v-model="draft.invoiceName"
          name="customer-invoice-name"
          autocomplete="organization"
          class="field-input w-full"
        >
      </label>
      <label class="field-block">
        <span class="field-label">开户行</span>
        <input
          v-model="draft.bank"
          name="customer-bank"
          autocomplete="off"
          class="field-input w-full"
        >
      </label>
      <label class="field-block">
        <span class="field-label">银行账号</span>
        <input
          v-model="draft.bankAccount"
          name="customer-bank-account"
          autocomplete="off"
          spellcheck="false"
          class="field-input w-full font-mono"
        >
      </label>
    </div>
  </section>

  <section id="section-contact" class="panel scroll-mt-4 p-4">
    <SectionHeader title="联系与备注" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">联系人 *</span>
        <input
          v-model="draft.contact"
          name="customer-contact"
          autocomplete="name"
          :class="fieldClass('contact')"
          data-field="contact"
          @input="emit('clearError', 'contact')"
        >
        <span v-if="fieldErrors.contact" class="field-error">{{ fieldErrors.contact }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">联系电话</span>
        <input
          v-model="draft.contactPhone"
          type="tel"
          name="customer-contact-phone"
          autocomplete="tel"
          class="field-input w-full"
        >
      </label>
    </div>
  </section>
</template>
