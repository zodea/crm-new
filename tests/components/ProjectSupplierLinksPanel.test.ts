import { render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectSupplierLinksPanel from '~/components/project/ProjectSupplierLinksPanel.vue'

const load = vi.fn().mockResolvedValue(undefined)

vi.stubGlobal('useProjectSupplierStore', () => ({
  loading: false,
  load,
  byProject: (projectId: string) => projectId === 'project-1'
    ? [{
        id: 'ps-1',
        projectId,
        supplierId: 'supplier-1',
        supplierName: '华东建材',
      }]
    : [],
}))

const NuxtLinkStub = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
})

describe('项目详情分供方入口', () => {
  beforeEach(() => {
    load.mockReset()
    load.mockResolvedValue(undefined)
  })

  it('从项目详情穿透真实合作工作台，并提供文件导入入口', () => {
    render(ProjectSupplierLinksPanel, {
      props: { projectId: 'project-1' },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          SectionHeader: defineComponent({ template: '<header><slot /><slot name="extra" /></header>' }),
          StatePanel: true,
        },
      },
    })

    expect(screen.getByRole('link', { name: /华东建材/ }).getAttribute('href'))
      .toBe('/project/project-1/supplier/supplier-1')
    expect(screen.getByRole('link', { name: /从文件导入分供方/ }).getAttribute('href'))
      .toBe('/project/project-1/supplier/import')
    expect(load).toHaveBeenCalled()
  })

  it('读取失败时显示错误和重试入口，不伪装成空数据', async () => {
    load.mockRejectedValueOnce(new Error('数据库暂不可用'))

    render(ProjectSupplierLinksPanel, {
      props: { projectId: 'project-2' },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          SectionHeader: defineComponent({ template: '<header><slot /><slot name="extra" /></header>' }),
          StatePanel: defineComponent({
            props: ['kind', 'title', 'description', 'actionLabel'],
            emits: ['action'],
            template: `
              <div :role="kind === 'error' ? 'alert' : 'status'">
                <span>{{ title }}</span>
                <span>{{ description }}</span>
                <button v-if="actionLabel" @click="$emit('action')">{{ actionLabel }}</button>
              </div>
            `,
          }),
        },
      },
    })

    expect(await screen.findByRole('alert')).not.toBeNull()
    expect(screen.getByText('数据库暂不可用')).not.toBeNull()
    expect(screen.queryByText('当前项目尚未关联分供方')).toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).not.toBeNull()
  })
})
