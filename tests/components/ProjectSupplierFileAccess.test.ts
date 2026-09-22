import type { ProjectSupplierFileContent, ProjectSupplierFileQuery } from '~/lib/project-supplier/file-content'
import type { ProjectSupplierFileDTO } from '~/lib/project-supplier/read-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectSupplierFileAccess from '~/components/project-supplier/ProjectSupplierFileAccess.vue'
import ProjectSupplierFilePanel from '~/components/project-supplier/ProjectSupplierFilePanel.vue'
import { exportFile as runExportFile } from '~/lib/kit/export'

const getContent = vi.fn()
const exportFile = vi.fn()
const writeFile = vi.fn()
const error = vi.fn()
const warning = vi.fn()
const query = { projectId: 'project-438', supplierId: 'supplier-438', relationId: 'relation-438', origin: 'real' as const, includeDemo: false }
const file: ProjectSupplierFileDTO = {
  file: { id: 'file-438', label: '合作原件.pdf', state: 'resolved', entity: 'file', no: null },
  ownerType: 'project_supplier',
  ownerId: query.relationId,
  sourceLabel: '合作档案',
  navigation: { kind: 'unavailable', reason: 'missing-route' },
  fileSize: 3,
  mimeType: 'application/pdf',
  category: '合同',
  uploader: '资料员',
  uploadedAt: '2026-09-10T00:00:00.000Z',
  content: { state: 'available', sha256: null },
}

function content(request: ProjectSupplierFileQuery): ProjectSupplierFileContent {
  return {
    ...request,
    dataOrigin: request.origin,
    state: 'available',
    bytes: new Uint8Array([1, 2, 3]),
    fileName: '合作原件.pdf',
    fileSize: 3,
    mimeType: 'application/pdf',
    sourceVersion: '1',
    sha256: 'a'.repeat(64),
  }
}

const KitButton = defineComponent({
  props: { disabled: Boolean, loading: Boolean },
  setup: (props, { slots }) => () => h('button', { disabled: props.disabled || props.loading }, slots.default?.()),
})

function mount(files = [file]) {
  return render(ProjectSupplierFileAccess, {
    props: { files, context: query, returnTo: '/project/project-438/supplier/supplier-438' },
    global: { components: { ProjectSupplierFilePanel, KitButton }, stubs: { ProjectSupplierSourceLink: true } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getContent.mockImplementation(async (query: ProjectSupplierFileQuery) => content(query))
  exportFile.mockImplementation(options => runExportFile(options, {
    pickDirectory: async () => ({ displayPath: '浏览器下载', supportsSubdirectories: false, writeFile }),
    feedback: { during: task => task(), success: vi.fn(), failure: vi.fn() },
  }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { projectSupplierRead: { getContent } } }))
  vi.stubGlobal('useKitUI', () => ({ exportFile, error, warning }))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:cooperation-438'), revokeObjectURL: vi.fn() })
})
afterEach(() => vi.restoreAllMocks())

describe('合作原件工作台动作', () => {
  it('浏览器阻止弹窗时提示用户且不读取正文', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    mount()
    await fireEvent.click(screen.getByRole('button', { name: '预览 合作原件.pdf' }))
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('阻止'))
    expect(getContent).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '取消读取' })).toBeNull()
  })

  it('完成 PDF 预览后释放对象 URL，弹窗不保留 opener', async () => {
    const opened = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window)
    const view = mount()
    await fireEvent.click(screen.getByRole('button', { name: '预览 合作原件.pdf' }))
    await waitFor(() => expect(opened.location.replace).toHaveBeenCalledWith('blob:cooperation-438'))
    expect(opened.opener).toBeNull()
    view.unmount()
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cooperation-438'))
  })

  it('取消旧预览后立即重试，旧响应迟到不会撤销已完成的新预览', async () => {
    const first = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    const second = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    vi.spyOn(window, 'open').mockReturnValueOnce(first as unknown as Window).mockReturnValueOnce(second as unknown as Window)
    let resolveFirst!: (value: ProjectSupplierFileContent) => void
    getContent.mockImplementationOnce(() => new Promise<ProjectSupplierFileContent>((resolve) => {
      resolveFirst = resolve
    }))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: '预览 合作原件.pdf' }))
    const firstRequest = getContent.mock.calls[0]![0]
    await fireEvent.click(screen.getByRole('button', { name: '取消读取' }))
    await fireEvent.click(screen.getByRole('button', { name: '预览 合作原件.pdf' }))
    await waitFor(() => expect(second.location.replace).toHaveBeenCalledWith('blob:cooperation-438'))
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    resolveFirst(content(firstRequest))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(second.close).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('旧预览迟到后，仍能取消新预览并关闭对应窗口', async () => {
    const first = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    const second = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    vi.spyOn(window, 'open').mockReturnValueOnce(first as unknown as Window).mockReturnValueOnce(second as unknown as Window)
    const pending: Array<{ query: ProjectSupplierFileQuery, resolve: (value: ProjectSupplierFileContent) => void }> = []
    getContent.mockImplementation((request: ProjectSupplierFileQuery) => new Promise<ProjectSupplierFileContent>((resolve) => {
      pending.push({ query: request, resolve })
    }))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: '预览 合作原件.pdf' }))
    await fireEvent.click(screen.getByRole('button', { name: '取消读取' }))
    await fireEvent.click(screen.getByRole('button', { name: '预览 合作原件.pdf' }))
    pending[0]!.resolve(content(pending[0]!.query))
    await new Promise(resolve => setTimeout(resolve, 0))
    await fireEvent.click(screen.getByRole('button', { name: '取消读取' }))
    expect(second.close).toHaveBeenCalledOnce()
    pending[1]!.resolve(content(pending[1]!.query))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(second.location.replace).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'source', 'unmount'])('%s 后迟到成功正文不保存、不显示成功或错误', async (action) => {
    let resolve!: (value: ProjectSupplierFileContent) => void
    getContent.mockImplementationOnce(() => new Promise<ProjectSupplierFileContent>((done) => {
      resolve = done
    }))
    const view = mount()
    await fireEvent.click(screen.getByRole('button', { name: '下载 合作原件.pdf' }))
    const [request, options] = getContent.mock.calls[0]!
    if (action === 'cancel')
      await fireEvent.click(screen.getByRole('button', { name: '取消读取' }))
    else if (action === 'source')
      await view.rerender({ context: { ...query, origin: 'demo', includeDemo: true } })
    else
      view.unmount()
    expect(options.signal.aborted).toBe(true)
    resolve(content(request))
    await new Promise(done => setTimeout(done, 0))
    expect(writeFile).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('zIP 读取失败保留选择并可重试；取消保存不会显示缺原件导出完成', async () => {
    const missing = { ...file, file: { ...file.file, id: 'missing', label: '历史扫描件.pdf' }, content: { state: 'missing' as const, sha256: null } }
    mount([file, missing])
    await fireEvent.click(screen.getByRole('checkbox', { name: '全选合作档案原件' }))
    getContent.mockRejectedValueOnce(new Error('中央暂时不可用'))
    await fireEvent.click(screen.getByRole('button', { name: '下载选中 ZIP' }))
    expect((await screen.findByRole('alert')).textContent).toContain('中央暂时不可用')
    expect((screen.getByRole('checkbox', { name: '选择 合作原件.pdf' }) as HTMLInputElement).checked).toBe(true)
    expect(writeFile).not.toHaveBeenCalled()
    getContent.mockImplementation(async (request: ProjectSupplierFileQuery) => request.fileId === 'missing'
      ? { ...content(request), state: 'missing', reason: 'missing-payload' }
      : content(request))
    exportFile.mockResolvedValueOnce({ status: 'cancelled' })
    await fireEvent.click(screen.getByRole('button', { name: '下载选中 ZIP' }))
    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('status')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '下载选中 ZIP' }))
    expect((await screen.findByRole('status')).textContent).toContain('1 份历史原件缺失')
  })

  it('未接入 owner 不可选择或下载，HTML 仅可下载', () => {
    mount([
      { ...file, ownerType: 'invoice', ownerId: 'invoice-438' },
      { ...file, file: { ...file.file, id: 'html', label: '附件.html' }, mimeType: 'text/html' },
    ])
    expect((screen.getByRole('checkbox', { name: '选择 合作原件.pdf' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '下载 合作原件.pdf' })).toBeNull()
    expect(screen.queryByRole('button', { name: '预览 附件.html' })).toBeNull()
    expect(screen.getByRole('button', { name: '下载 附件.html' })).toBeTruthy()
    expect(getContent).not.toHaveBeenCalled()
  })

  it('打开预览窗口抛错后显示原因并解除忙碌，允许再次下载', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('预览窗口暂不可用')
    })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: '预览 合作原件.pdf' }))
    expect((await screen.findByRole('alert')).textContent).toContain('预览窗口暂不可用')
    expect(screen.queryByRole('button', { name: '取消读取' })).toBeNull()
    expect(getContent).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '下载 合作原件.pdf' }))
    await waitFor(() => expect(exportFile).toHaveBeenCalledOnce())
  })

  it('列表不读取正文，下载只请求选定中央身份并交 KitUI 保存原始字节', async () => {
    mount()
    expect(getContent).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '下载 合作原件.pdf' }))
    await waitFor(() => expect(exportFile).toHaveBeenCalledOnce())
    expect(getContent).toHaveBeenCalledWith({ ...query, fileId: file.file.id, ownerType: file.ownerType, ownerId: file.ownerId }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await waitFor(() => expect(writeFile).toHaveBeenCalledWith('合作原件.pdf', new Uint8Array([1, 2, 3]), 'application/pdf'))
  })
})
