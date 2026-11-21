import type { ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ProjectSupplierFactTable from '~/pages/project/[pid]/supplier/_components/ProjectSupplierFactTable.vue'
import ProjectSupplierOverview from '~/pages/project/[pid]/supplier/_components/ProjectSupplierOverview.vue'

const entityLink = defineComponent({
  props: ['label', 'returnTo'],
  template: '<a href="#" :data-return-to="returnTo">{{ label }}</a>',
})

const data = {
  projectNavigation: { kind: 'entity-detail' },
  project: { label: '中央项目' },
  projectProfile: { status: '施工中', manager: '张经理', developer: '建设单位' },
  supplierNavigation: { kind: 'entity-detail' },
  supplier: { label: '中央分供方' },
  supplierProfile: { supplierCategory: '材料供应商', contact: '李经理', contactPhone: '13800000000' },
} as ProjectSupplierWorkbenchReadDTO

describe('项目分供方身份概览', () => {
  it('项目和分供方身份链接共享当前工作台受限返回地址，说明按需展开且不污染标题', async () => {
    const returnTo = '/project/project-1/supplier/supplier-1?origin=demo&tab=overview'
    render(ProjectSupplierOverview, {
      props: { data, returnTo },
      global: { components: { EntityLink: entityLink } },
    })

    expect(screen.getByRole('link', { name: '中央项目' }).getAttribute('data-return-to')).toBe(returnTo)
    expect(screen.getByRole('link', { name: '中央分供方' }).getAttribute('data-return-to')).toBe(returnTo)
    expect(screen.getByRole('heading', { name: '项目身份', exact: true })).not.toBeNull()
    expect(screen.queryByText(/最终结算登记暂不可用/)).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '查看工作台数据说明' }))
    expect(screen.getByText(/最终结算登记暂不可用/)).not.toBeNull()
    expect(screen.queryByText(/Repository/)).toBeNull()
  })
})

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
