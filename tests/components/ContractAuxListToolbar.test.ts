import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ContractAuxListToolbar from '~/components/contract/ContractAuxListToolbar.vue'

describe('辅助合同工具栏说明', () => {
  it('保留标题和真实操作，将业务解释收进就近帮助', () => {
    render(ContractAuxListToolbar, { props: {
      title: '公司支出合同',
      subtitle: '公司层面 · 房租/软件/其他 · 不挂项目',
      createLabel: '新建公司支出合同',
      loading: false,
      searchPlaceholder: '搜索合同',
      showProject: false,
      showCategory: true,
      projectOptions: [],
      categoryOptions: [{ key: '房租', label: '房租' }],
      statusOptions: [{ key: '草稿', label: '草稿' }],
      search: '',
      project: [],
      category: [],
      status: [],
    } })
    expect(screen.queryByText('公司层面 · 房租/软件/其他 · 不挂项目')).toBeNull()
    expect(screen.getByRole('button', { name: '查看公司支出合同说明' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '类别，已选 0 项' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建公司支出合同' })).toBeTruthy()
  })
})
