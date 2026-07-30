import type { ProjectSupplierFileFact } from '~/lib/project-supplier/workbench'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectSupplierFilePanel from '~/components/project-supplier/ProjectSupplierFilePanel.vue'

vi.stubGlobal('useFileRefAccess', () => ({
  preview: vi.fn(),
  download: vi.fn(),
}))

const NuxtLinkStub = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
})

function file(overrides: Partial<ProjectSupplierFileFact>): ProjectSupplierFileFact {
  return {
    id: 'file-1',
    ownerType: 'contract',
    ownerId: 'contract-1',
    sourceLabel: 'CG-001',
    sourcePath: '/contract/contract-1',
    fileName: '合同.pdf',
    filePath: '',
    fileSize: 100,
    mimeType: 'application/pdf',
    category: '合同附件',
    uploader: '',
    uploadedAt: '2026-07-30T10:00:00',
    deletedAt: null,
    ...overrides,
  }
}

describe('项目分供方合作文件', () => {
  it('同名源单按真实 owner 分组并分别穿透来源', () => {
    render(ProjectSupplierFilePanel, {
      props: {
        files: [
          file({ id: 'file-1', ownerId: 'contract-1', sourcePath: '/contract/contract-1' }),
          file({ id: 'file-2', ownerId: 'contract-2', sourcePath: '/contract/contract-2' }),
        ],
      },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
        },
      },
    })

    expect(screen.getAllByText('CG-001')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: '查看来源' }).map(link => link.getAttribute('href')))
      .toEqual(['/contract/contract-1', '/contract/contract-2'])
  })
})
