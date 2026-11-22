import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectSupplierLinksPanel from '~/pages/project/_components/ProjectSupplierLinksPanel.vue'

const NuxtLinkStub = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
})

describe('项目详情分供方入口', () => {
  it('只按中央 DTO 的双父身份穿透真实合作工作台，并提供正式导入入口', () => {
    render(ProjectSupplierLinksPanel, {
      props: {
        projectId: 'project-1',
        origin: 'real',
        access: 'allowed',
        canImport: true,
        relationships: [{
          relationId: 'ps-1',
          supplier: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '华东建材', no: null },
          navigation: {
            kind: 'entity-subview',
            subject: { state: 'resolved', entity: 'project', id: 'project-1', label: '中央项目', no: null },
            variant: 'supplier-workbench',
            view: 'overview',
            filters: { supplierId: 'supplier-1', dataOrigin: 'real' },
          },
        }],
      },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          SectionHeader: defineComponent({ template: '<header><slot /><slot name="extra" /></header>' }),
          StatePanel: true,
        },
      },
    })

    expect(screen.getByRole('link', { name: /华东建材/ }).getAttribute('href'))
      .toBe('/project/project-1/supplier/supplier-1?tab=overview')
    expect(screen.getByRole('link', { name: /从文件导入分供方/ }).getAttribute('href'))
      .toBe('/project/project-1/supplier/import?origin=real')
  })

  it('中央读取失败时显示错误，不伪装成空数据或本地回退', async () => {
    render(ProjectSupplierLinksPanel, {
      props: { projectId: 'project-2', origin: 'real', access: 'error', relationships: [] },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          SectionHeader: defineComponent({ template: '<header><slot /><slot name="extra" /></header>' }),
          StatePanel: defineComponent({
            props: ['kind', 'title', 'description', 'actionLabel'],
            template: `
              <div :role="kind === 'error' ? 'alert' : 'status'">
                <span>{{ title }}</span>
                <span>{{ description }}</span>
              </div>
            `,
          }),
        },
      },
    })

    expect(await screen.findByRole('alert')).not.toBeNull()
    expect(screen.getByText('中央关系暂不可用，请刷新项目详情重试。')).not.toBeNull()
    expect(screen.queryByText('当前项目尚未关联分供方')).toBeNull()
  })
})
