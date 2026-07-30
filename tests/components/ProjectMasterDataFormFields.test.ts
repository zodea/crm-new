import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import ProjectMasterDataFormFields from '~/components/master-data/ProjectMasterDataFormFields.vue'

const LookupSelectStub = defineComponent({
  props: {
    field: { type: String, default: '' },
    placeholder: { type: String, required: true },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('button', {
      'type': 'button',
      'data-field': props.field,
      'aria-label': props.placeholder,
      'onClick': () => emit(
        'update:modelValue',
        props.field === 'customerId'
          ? 'customer-primary-id'
          : 'customer-secondary-id',
      ),
    }, props.placeholder)
  },
})

const SectionHeaderStub = defineComponent({
  props: { title: { type: String, required: true } },
  setup: props => () => h('h2', props.title),
})

describe('项目表单字段', () => {
  it('按可见字段顺序呈现两列自适应分区，并让两个客户 lookup 绑定真实 ID', async () => {
    const fetchCustomers = vi.fn().mockResolvedValue([])
    const Harness = defineComponent({
      components: { ProjectMasterDataFormFields },
      setup() {
        const draft = reactive({
          name: '',
          customerId: null,
          secondaryCustomerId: null,
          manager: '',
          operationType: '自营',
          status: '筹备中',
          riskLevel: '低',
        })
        return { draft, fetchCustomers }
      },
      template: `
        <ProjectMasterDataFormFields
          v-model="draft"
          :field-errors="{}"
          :fetch-customers="fetchCustomers"
        />
        <output aria-label="主客户 ID">{{ draft.customerId }}</output>
        <output aria-label="次客户 ID">{{ draft.secondaryCustomerId }}</output>
      `,
    })

    const view = render(Harness, {
      global: {
        components: {
          LookupSelect: LookupSelectStub,
          SectionHeader: SectionHeaderStub,
        },
      },
    })

    expect(screen.getAllByRole('heading').map(item => item.textContent)).toEqual([
      '基本信息',
      '工期与阶段',
      '参建单位',
      '风控与立项',
    ])
    expect(view.container.querySelectorAll('.form-fields-grid')).toHaveLength(4)
    expect(view.container.querySelector('[data-field="customerId"]')).not.toBeNull()
    expect(view.container.querySelector('[data-field="secondaryCustomerId"]')).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '检索客户' }))
    await fireEvent.click(screen.getByRole('button', { name: '检索次客户' }))

    expect(screen.getByLabelText('主客户 ID').textContent).toBe('customer-primary-id')
    expect(screen.getByLabelText('次客户 ID').textContent).toBe('customer-secondary-id')
  })
})
