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
    invalid: { type: Boolean, default: false },
    descriptionId: { type: String, default: '' },
    field: { type: String, default: '' },
    placeholder: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      v-bind="$attrs"
      type="button"
      :disabled="Boolean(disabledReason)"
      :data-disabled-reason="disabledReason"
      :data-field="field"
      :aria-invalid="invalid || undefined"
      :aria-describedby="descriptionId || undefined"
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
    NuxtLink: defineComponent({
      props: { to: { type: String, required: true } },
      template: '<a :href="to"><slot /></a>',
    }),
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

  it('associates ordinary and lookup errors with their controls', () => {
    const wrapper = mount(OwnerDocumentFormFields, {
      props: {
        kind: 'owner_change',
        draft: ownerDocumentDefaults('owner_change'),
        fieldErrors: {
          name: '变更名称为必填项',
          projectId: '项目为必填项',
        },
        fetchProjects: fetchLookup,
        fetchSuppliers: fetchLookup,
        fetchContracts: fetchLookup,
        fetchCrews: fetchLookup,
      },
      global,
    })

    const name = wrapper.get('[data-testid="owner-document-name"]')
    expect(name.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get(`#${name.attributes('aria-describedby')}`).text())
      .toBe('变更名称为必填项')

    const project = wrapper.get('[data-testid="owner-document-projectId"]')
    expect(project.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get(`#${project.attributes('aria-describedby')}`).text())
      .toBe('项目为必填项')
  })

  it('shows the matching contract list when a project has no eligible contract', () => {
    const wrapper = mount(OwnerDocumentFormFields, {
      props: {
        kind: 'sub_settlement',
        draft: {
          ...ownerDocumentDefaults('sub_settlement'),
          projectId: 'project-real',
        },
        fieldErrors: {},
        eligibleContractCount: 0,
        fetchProjects: fetchLookup,
        fetchSuppliers: fetchLookup,
        fetchContracts: fetchLookup,
        fetchCrews: fetchLookup,
      },
      global,
    })

    expect(wrapper.get('[role="status"]').text()).toContain('当前项目暂无可选的分包合同')
    expect(wrapper.get('a').attributes('href')).toBe('/contract/subcontract')
  })

  it('草稿仅允许编辑基本信息，未来验收和保修事实保持禁用', () => {
    const wrapper = mountFields('acceptance')

    expect(wrapper.get('[data-testid="owner-document-name"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="owner-document-acceptanceOrganization"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="owner-document-warrantyOwner"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="owner-document-warrantyConfirmationOrganization"]').attributes('disabled')).toBeDefined()
  })
})
