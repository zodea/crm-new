import type { CrewFormDraft } from '~/lib/master-data/forms'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import CrewFormFields from '~/components/master-data/CrewFormFields.vue'

const SectionHeader = defineComponent({
  props: ['title', 'subtitle'],
  template: '<header><h2>{{ title }}</h2><p>{{ subtitle }}</p></header>',
})

const MasterDataCapabilityFields = defineComponent({
  template: '<div data-testid="capability-fields" />',
})

function draft(overrides: Partial<CrewFormDraft> = {}): CrewFormDraft {
  return {
    id: '',
    name: '',
    trade: '',
    contactName: '',
    contactPhone: '',
    capabilityTrades: [],
    capabilityItems: [],
    defaultPayRatio: 0.95,
    rentSubsidyEnabled: false,
    rentSubsidyPrice: null,
    mgmtFeeEnabled: false,
    mgmtFeePrice: null,
    assignmentLevel: 'crew',
    note: '',
    status: 'draft',
    ...overrides,
  }
}

describe('班组表单领域字段', () => {
  it('电话使用电话输入语义，计薪字段明确为班组级默认值', () => {
    const wrapper = mount(CrewFormFields, {
      props: {
        modelValue: draft(),
        fieldErrors: {},
      },
      global: {
        components: {
          MasterDataCapabilityFields,
          SectionHeader,
        },
      },
    })

    const phone = wrapper.get('input[data-field="contactPhone"]')
    expect(phone.attributes()).toMatchObject({
      type: 'tel',
      inputmode: 'tel',
      autocomplete: 'tel',
    })
    expect(wrapper.text()).toContain('以下为班组档案默认值，不按项目复制配置')
    expect(wrapper.get('input[data-field="rentSubsidyPrice"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[data-field="mgmtFeePrice"]').attributes('disabled')).toBeDefined()
  })

  it('勾选补贴和提成后开放对应单价字段', async () => {
    const wrapper = mount(CrewFormFields, {
      props: {
        modelValue: draft(),
        fieldErrors: {},
      },
      global: {
        components: {
          MasterDataCapabilityFields,
          SectionHeader,
        },
      },
    })

    const toggles = wrapper.findAll('input[type="checkbox"]')
    await toggles[0]!.setValue(true)
    await toggles[1]!.setValue(true)

    expect(wrapper.get('input[data-field="rentSubsidyPrice"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('input[data-field="mgmtFeePrice"]').attributes('disabled')).toBeUndefined()
  })
})
