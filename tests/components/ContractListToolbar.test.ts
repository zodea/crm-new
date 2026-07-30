import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ContractListToolbar from '~/components/contract/ContractListToolbar.vue'

const SelectFilterStub = defineComponent({
  props: {
    label: String,
  },
  setup(props) {
    return () => h('label', [
      props.label,
      h('select', { 'aria-label': props.label }, [
        h('option', { value: 'all' }, '全部项目'),
      ]),
    ])
  },
})

const SearchInputStub = defineComponent({
  props: {
    placeholder: String,
  },
  setup(props) {
    return () => h('input', {
      'aria-label': props.placeholder,
      'type': 'search',
    })
  },
})

const global = {
  components: {
    SearchInput: SearchInputStub,
    SelectFilter: SelectFilterStub,
  },
}

describe('contract list toolbar', () => {
  const props = {
    search: '',
    project: 'all',
    party: 'all',
    status: '履约中',
    title: '分包合同',
    loading: false,
    projectOptions: [{ key: 'all', label: '全部项目' }],
    partyLabel: '分供方',
    partyOptions: [{ key: 'all', label: '全部分供方' }],
    statusOptions: [{ key: '履约中', label: '履约中 2' }],
  }

  it('只显示稳定标题和操作，不重复渲染动态合同数量', () => {
    render(ContractListToolbar, { props, global })

    expect(screen.getByRole('heading', { name: '分包合同' })).not.toBeNull()
    expect(screen.queryByText(/共\s*9\s*份/)).toBeNull()
    expect(screen.queryByText(/当前\s*4\s*份/)).toBeNull()
  })

  it('保留项目、分供方、状态、搜索、刷新和新增操作入口', async () => {
    const view = render(ContractListToolbar, { props, global })

    expect(screen.getByRole('combobox', { name: '项目' })).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '分供方' })).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '状态' })).not.toBeNull()
    expect(screen.getByRole('searchbox', { name: '搜索合同名称 / 编号' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await fireEvent.click(screen.getByRole('button', { name: '新增分包合同' }))

    expect(view.emitted().refresh).toHaveLength(1)
    expect(view.emitted().create).toHaveLength(1)
  })
})
