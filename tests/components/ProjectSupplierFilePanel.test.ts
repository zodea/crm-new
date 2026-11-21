import type { ProjectSupplierFileDTO } from '~/lib/project-supplier/repository'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectSupplierFilePanel from '~/components/project-supplier/ProjectSupplierFilePanel.vue'

const EntityLinkStub = defineComponent({
  props: { label: String, intent: Object, returnTo: String },
  setup: props => () => h('a', {
    'href': `/contract/${String((props.intent as ProjectSupplierFileDTO['navigation']).subject && 'id' in (props.intent as ProjectSupplierFileDTO['navigation']).subject ? (props.intent as ProjectSupplierFileDTO['navigation']).subject.id : '')}`,
    'data-return-to': props.returnTo,
  }, props.label),
})

function file(overrides: Partial<ProjectSupplierFileDTO>): ProjectSupplierFileDTO {
  return {
    file: { state: 'resolved', entity: 'file', id: 'file-1', label: '合同.pdf', no: null },
    ownerType: 'contract',
    ownerId: 'contract-1',
    sourceLabel: 'CG-001',
    navigation: {
      kind: 'source-record',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-1', label: 'CG-001', no: 'CG-001' },
      variant: 'detail',
      view: null,
      filters: {},
    },
    fileSize: 100,
    mimeType: 'application/pdf',
    category: '合同附件',
    uploader: '',
    uploadedAt: '2026-07-30T10:00:00',
    ...overrides,
  }
}

describe('项目分供方合作文件', () => {
  it('同名源单按真实 owner 分组并分别穿透来源', () => {
    render(ProjectSupplierFilePanel, {
      props: {
        files: [
          file({ ownerId: 'contract-1' }),
          file({
            file: { state: 'resolved', entity: 'file', id: 'file-2', label: '合同.pdf', no: null },
            ownerId: 'contract-2',
            navigation: {
              kind: 'source-record',
              subject: { state: 'resolved', entity: 'contract', id: 'contract-2', label: 'CG-001', no: 'CG-001' },
              variant: 'detail',
              view: null,
              filters: {},
            },
          }),
        ],
        returnTo: '/project/project-1/supplier/supplier-1?tab=contract',
      },
      global: {
        stubs: {
          ProjectSupplierSourceLink: EntityLinkStub,
        },
      },
    })

    expect(screen.getAllByText('CG-001')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: '查看来源' }).map(link => link.getAttribute('href')))
      .toEqual(['/contract/contract-1', '/contract/contract-2'])
  })
})
