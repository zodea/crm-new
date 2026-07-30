import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import PaymentManagementToolbar from '~/components/finance/payment-management/PaymentManagementToolbar.vue'
import SearchInput from '~/components/ui/SearchInput.vue'

const SelectFilterStub = defineComponent({
  props: {
    label: String,
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('select', {
      'aria-label': props.label,
      'onChange': () => emit('update:modelValue', 'project-1'),
    }, [
      h('option', { value: 'all' }, '全部项目'),
      h('option', { value: 'project-1' }, '项目一'),
    ])
  },
})

const ButtonStub = defineComponent({
  setup(_, { slots }) {
    return () => h('button', { type: 'button' }, slots.default?.())
  },
})

const global = {
  components: {
    Button: ButtonStub,
    SearchInput,
    SelectFilter: SelectFilterStub,
  },
}

describe('payment management toolbar', () => {
  it('将搜索和项目筛选值透传给工作台', async () => {
    const view = render(PaymentManagementToolbar, {
      props: {
        search: '',
        project: 'all',
        loading: false,
        projectOptions: [
          { key: 'all', label: '全部项目' },
          { key: 'project-1', label: '项目一' },
        ],
      },
      global,
    })

    await fireEvent.update(
      screen.getByRole('searchbox', { name: '搜索申请名称、编号或收款单位' }),
      '五金机电',
    )
    await fireEvent.update(screen.getByRole('combobox', { name: '项目' }), 'project-1')

    expect(view.emitted()['update:search']).toEqual([['五金机电']])
    expect(view.emitted()['update:project']).toEqual([['project-1']])
  })
})
