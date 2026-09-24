import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ProjectSupplierFactTable from '~/components/project-supplier/ProjectSupplierFactTable.vue'

describe('项目分供方事实表', () => {
  it('真实零记录仍保留列头和明确空态', () => {
    render(ProjectSupplierFactTable, {
      props: { columns: ['编号', '金额'], rows: [], empty: '暂无合同事实', returnTo: '/project/p/supplier/s?tab=contract' },
      global: { stubs: { ProjectSupplierSourceLink: true } },
    })
    expect(screen.getByRole('columnheader', { name: '编号' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '金额' })).toBeTruthy()
    expect(screen.getByText('暂无合同事实')).toBeTruthy()
  })
})
