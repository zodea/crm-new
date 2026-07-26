import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import OwnerDocumentFormFields from '~/components/owner-document/OwnerDocumentFormFields.vue'
import { ownerDocumentDefaults } from '~/lib/owner-document/page'

const SectionHeader = defineComponent({
  props: { title: { type: String, required: true } },
  template: '<h2>{{ title }}</h2>',
})

const LookupSelect = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: null },
    disabledReason: { type: String, default: '' },
    placeholder: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      v-bind="$attrs"
      type="button"
      :disabled="Boolean(disabledReason)"
      :data-disabled-reason="disabledReason"
      @click="$emit('update:modelValue', 'real-id')"
    >
      {{ placeholder }}
    </button>
  `,
})

const SelectFilter = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      v-bind="$attrs"
      type="button"
      :disabled="disabled"
      @click="$emit('update:modelValue', 'site_visa')"
    >
      {{ modelValue }}
    </button>
  `,
})

const fetchLookup = vi.fn(async () => [])
const global = {
  components: {
    LookupSelect,
    SectionHeader,
    SelectFilter,
  },
}

function mountFields(kind: Parameters<typeof ownerDocumentDefaults>[0], readonly = false) {
  return mount(OwnerDocumentFormFields, {
    props: {
      kind,
      draft: ownerDocumentDefaults(kind),
      fieldErrors: {},
      readonly,
      fetchProjects: fetchLookup,
      fetchSuppliers: fetchLookup,
      fetchContracts: fetchLookup,
      fetchCrews: fetchLookup,
    },
    global,
  })
}

describe('ownerDocumentFormFields data flow', () => {
  it('keeps the document type independent from BOQ line operation and emits numeric amounts', async () => {
    const wrapper = mountFields('owner_change')

    expect(wrapper.find('[data-testid="owner-document-documentType"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="owner-document-supplierId"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="owner-document-contractId"]').attributes('data-disabled-reason'))
      .toBe('请先选择项目')

    await wrapper.get('[data-testid="owner-document-approvedTaxInclusiveAmount"]').setValue('125.5')
    expect(wrapper.emitted('patch')?.at(-1)?.[0]).toEqual({
      approvedTaxInclusiveAmount: 125.5,
    })
  })

  it('renders only the subcontract settlement fields and locks final records', () => {
    const wrapper = mountFields('sub_settlement', true)

    expect(wrapper.find('[data-testid="owner-document-supplierId"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="owner-document-totalAmount"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="owner-document-lines"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="owner-document-projectId"]').attributes('data-disabled-reason'))
      .toBe('已生效单据不可修改')
    expect(wrapper.get('[data-testid="owner-document-name"]').attributes('disabled'))
      .toBeDefined()
  })
})
