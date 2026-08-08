import type { Component } from 'vue'
import type { ProjectArchiveSnapshot } from '~/lib/project/archive'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectArchiveExportDialog from '~/components/project/ProjectArchiveExportDialog.vue'
import ProjectArchiveTreeNode from '~/components/project/ProjectArchiveTreeNode.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'

const loadSnapshot = vi.hoisted(() => vi.fn())
const createZip = vi.hoisted(() => vi.fn())

vi.mock('~/lib/project/archive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/project/archive')>()
  return {
    ...actual,
    loadProjectArchiveSnapshot: loadSnapshot,
    createProjectArchiveZip: createZip,
  }
})

const snapshot: ProjectArchiveSnapshot = {
  project: {
    id: 'project-1',
    name: '合和新城',
    code: 'HHXC-01',
    status: '施工中',
    manager: '项目经理',
  },
  folders: [],
  files: [
    {
      id: 'normal-1',
      ownerType: 'project',
      ownerId: 'project-1',
      fileName: '立项批复.pdf',
      fileSize: 4,
      mimeType: 'application/pdf',
      category: '立项',
      uploader: '资料员',
      uploadedAt: '2026-08-08',
      sourceLabel: '合和新城',
      folderPath: ['01_项目'],
      archivePath: '01_项目/立项批复.pdf',
      sensitivity: 'normal',
      hasPayload: true,
    },
    {
      id: 'sensitive-1',
      ownerType: 'worker',
      ownerId: 'worker-1',
      fileName: '银行卡资料.pdf',
      fileSize: 4,
      mimeType: 'application/pdf',
      category: '银行卡',
      uploader: '人事',
      uploadedAt: '2026-08-08',
      sourceLabel: '张三',
      folderPath: ['03_班组与工人'],
      archivePath: '03_班组与工人/张三/银行卡资料.pdf',
      sensitivity: 'sensitive',
      hasPayload: true,
    },
  ],
  tree: [
    {
      key: 'folder:project',
      label: '01_项目信息与工程档案',
      kind: 'folder',
      empty: false,
      children: [
        {
          key: 'file:normal-1',
          label: '立项批复.pdf',
          kind: 'file',
          file: undefined,
        },
      ],
    },
  ],
}
snapshot.tree[0]!.children = [
  { key: 'file:normal-1', label: '立项批复.pdf', kind: 'file', file: snapshot.files[0] },
  { key: 'file:sensitive-1', label: '银行卡资料.pdf', kind: 'file', sensitive: true, file: snapshot.files[1] },
]

const kitUi = {
  confirm: vi.fn().mockResolvedValue(false),
  error: vi.fn(),
  exportFile: vi.fn().mockResolvedValue({ status: 'exported', displayPath: '浏览器下载' }),
  success: vi.fn(),
  warning: vi.fn(),
}

const globalComponents: Record<string, Component> = {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ProjectArchiveTreeNode,
  StatePanel: {
    template: '<div role="status"><slot />{{ title }}</div>',
    props: ['title'],
  },
}

describe('项目档案包导出选择器', () => {
  beforeEach(() => {
    loadSnapshot.mockReset()
    loadSnapshot.mockResolvedValue(snapshot)
    createZip.mockReset()
    createZip.mockResolvedValue({ data: new Uint8Array([1]), exportedFiles: [snapshot.files[0]], missingFiles: [] })
    for (const method of Object.values(kitUi))
      method.mockClear()
    vi.stubGlobal('useKitUI', () => kitUi)
  })

  it('打开后读取真实快照，默认勾选非敏感原件并标出敏感资料', async () => {
    render(ProjectArchiveExportDialog, {
      props: { projectId: 'project-1', open: true },
      global: { components: globalComponents },
    })

    await waitFor(() => expect(screen.getByText(/合和新城/)).toBeTruthy())
    expect(screen.getByRole('checkbox', { name: '取消 立项批复.pdf' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: '查看 银行卡资料.pdf，原件导出权限待配置' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getAllByText('仅查看').length).toBeGreaterThan(0)
  })

  it('证照在目录中可见但不可勾选，当前导出只提交普通原件', async () => {
    render(ProjectArchiveExportDialog, {
      props: { projectId: 'project-1', open: true },
      global: { components: globalComponents },
    })
    await waitFor(() => expect(screen.getByText(/合和新城/)).toBeTruthy())

    const sensitiveCheckbox = screen.getByRole('checkbox', { name: '查看 银行卡资料.pdf，原件导出权限待配置' })
    expect(sensitiveCheckbox.getAttribute('disabled')).not.toBeNull()
    expect(screen.getAllByText('原件导出待配置').length).toBeGreaterThan(0)
    await fireEvent.click(screen.getByRole('button', { name: '开始导出 ZIP' }))
    expect(kitUi.confirm).not.toHaveBeenCalled()
    expect(createZip).toHaveBeenCalled()
    expect(createZip.mock.calls[0][1].selectedFileIds).toEqual(new Set(['normal-1']))
    expect(kitUi.exportFile).toHaveBeenCalled()
  })
})
