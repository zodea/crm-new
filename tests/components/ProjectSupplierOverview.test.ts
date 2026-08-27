import type { ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ProjectSupplierOverview from '~/components/project-supplier/ProjectSupplierOverview.vue'

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
  it('项目和分供方身份链接共享当前工作台受限返回地址', () => {
    const returnTo = '/project/project-1/supplier/supplier-1?origin=demo&tab=overview'
    render(ProjectSupplierOverview, {
      props: { data, returnTo },
      global: { components: { EntityLink: entityLink } },
    })

    expect(screen.getByRole('link', { name: '中央项目' }).getAttribute('data-return-to')).toBe(returnTo)
    expect(screen.getByRole('link', { name: '中央分供方' }).getAttribute('data-return-to')).toBe(returnTo)
  })
})
