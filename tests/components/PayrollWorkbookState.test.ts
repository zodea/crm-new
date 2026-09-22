import type { PayrollListRead } from '~/lib/payroll/central-contract'
import type { PayrollWorkbookArchive, PayrollWorkbookPreview } from '~/lib/payroll/central-workbook-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, ref } from 'vue'
import { usePayrollWorkbook } from '~/composables/usePayrollWorkbook'
import * as workbookOutput from '~/lib/payroll/workbook-export'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
const repository = { list: vi.fn(), workbookArchives: vi.fn(), workbookArchive: vi.fn(), workbookPreview: vi.fn() }
const roster = { archives: vi.fn(), archive: vi.fn(), file: vi.fn() }
const execute = vi.fn()
const recover = vi.fn()
const acknowledge = vi.fn()
let pending: null | { projectId: string } = null
vi.mock('~/stores/payroll-workbook', () => ({ usePayrollWorkbookStore: () => ({ repository, execute, recover, acknowledge, restore: vi.fn(), get pending() {
  return pending
} }) }))
const route = reactive({ path: '/subcontract/payroll/workbooks', query: { origin: 'real', project: 'project-one' } as Record<string, string> })
const success = vi.fn()
const exportFile = vi.fn(async (options: { data: () => Promise<unknown> }) => options.data())
const context = { workspaceId: 'work', actorId: 'actor', sourceVersion: 'v1', capabilities: ['payroll:read', 'payroll:write', 'worker:sensitive:read'], origin: 'real' as const, readonly: false }
const input = { projectId: 'project-one', mode: 'project-month' as const, statementIds: ['salary'], rosterArchiveId: null }
const preview: PayrollWorkbookPreview = { context, input, sourceVersion: 'preview-v1', projectName: '项目一', groups: [], gaps: [], deliveryGaps: [], issues: [], roster: null, rosterRef: null, eligibility: { canSave: true, reasons: [] } }
const archive: PayrollWorkbookArchive = { ...preview, schemaVersion: 1, id: 'directory-one', version: 1, createdAt: '2026-09-22T10:00:00Z', createdBy: 'actor', manifestHash: 'a'.repeat(64), completeness: 'complete' }
function listing(projectId = 'project-one'): PayrollListRead {
  return { context, projects: [{ id: projectId, name: projectId, code: '' }], rows: [{ id: 'salary', projectId, leaderWorkerId: 'worker', formatFamily: 'A', recordKind: 'central', status: 'released', hidden: false, deletedAt: null }], diagnostics: [] } as unknown as PayrollListRead
}
let ui: ReturnType<typeof usePayrollWorkbook>
const Harness = defineComponent({ setup() {
  ui = usePayrollWorkbook()
  return () => h('div', ui.list.value?.projects[0]?.id ?? '未读取')
} })
beforeEach(() => {
  vi.clearAllMocks()
  pending = null
  route.query = { origin: 'real', project: 'project-one' }
  repository.list.mockImplementation(async (query: { projectId?: string }) => listing(query.projectId))
  repository.workbookArchives.mockResolvedValue([])
  repository.workbookArchive.mockResolvedValue(archive)
  repository.workbookPreview.mockResolvedValue(preview)
  roster.archives.mockResolvedValue([])
  execute.mockResolvedValue({ commandId: 'command', archiveId: archive.id, version: 1, manifestHash: archive.manifestHash })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace: vi.fn(async () => undefined), push: vi.fn(), resolve: () => ({ fullPath: '/subcontract/payroll/workbooks?origin=real&project=project-one' }) }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { workerRoster: roster } }))
  vi.stubGlobal('useKitUI', () => ({ success, exportFile }))
  vi.stubGlobal('useTabCloseGuard', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it('普通工资权限可打开目录，不预读私密版本；项目切换后的迟到读取不会串入', async () => {
  let finish!: (read: PayrollListRead) => void
  repository.list.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  repository.list.mockImplementationOnce(async () => ({ ...listing('project-two'), context: { ...context, capabilities: ['payroll:read'] } }))
  const wrapper = mount(Harness)
  route.query.project = 'project-two'
  await flushPromises()
  finish(listing())
  await flushPromises()
  expect(wrapper.text()).toBe('project-two')
  expect(ui.privateReadable.value).toBe(false)
  expect(roster.archives).not.toHaveBeenCalled()
  expect(ui.opened.value).toBeNull()
  wrapper.unmount()
})

it('保存并完整回读后只提示目录已保存，下载另做；丢响应保留原键核对', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  ui.change({ mode: 'project-month' })
  await ui.buildPreview()
  await ui.save()
  expect(success).toHaveBeenCalledWith('工资目录已保存；文件尚未下载')
  expect(exportFile).not.toHaveBeenCalled()
  ui.change({ mode: 'project-month' })
  await ui.buildPreview()
  execute.mockImplementationOnce(async () => {
    pending = { projectId: 'project-one' }
    throw new Error('响应丢失')
  })
  await ui.save()
  expect(ui.error.value).toContain('响应丢失')
  expect(ui.pending.value).toEqual({ projectId: 'project-one' })
  recover.mockResolvedValueOnce({ resolution: { state: 'applied' }, archive })
  await ui.recover()
  expect(execute).toHaveBeenCalledTimes(2)
  expect(ui.opened.value?.id).toBe(archive.id)
  expect(acknowledge).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})

it('下载重新读取失败清除旧目录，页面停用后的迟到保存不显示成功', async () => {
  const active = ref(true)
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, () => active.value ? h(Harness) : h('div', 'other')) }))
  await flushPromises()
  await ui.open(archive.id)
  repository.workbookArchive.mockRejectedValueOnce(new Error('权限已收回'))
  await ui.download('public-zip')
  expect(ui.opened.value).toBeNull()
  expect(ui.error.value).toContain('权限已收回')
  ui.change({ mode: 'project-month' })
  await ui.buildPreview()
  let finish!: (value: unknown) => void
  execute.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  const saving = ui.save()
  await flushPromises()
  active.value = false
  await flushPromises()
  finish({ commandId: 'late', archiveId: archive.id, version: 1, manifestHash: archive.manifestHash })
  await saving
  expect(ui.opened.value).toBeNull()
  expect(success).not.toHaveBeenCalled()
  wrapper.unmount()
})

it.each(['identity', 'hash', 'private'] as const)('文件最终读取遇到 %s 变化时拒绝返回文件并清除旧目录', async (change) => {
  const plain = vi.spyOn(workbookOutput, 'createPayrollSavedWorkbook').mockReturnValue({ data: new Uint8Array([1]), defaultName: 'test.xlsx', mimeType: 'application/octet-stream' })
  const zipped = vi.spyOn(workbookOutput, 'createPayrollSavedArchive').mockResolvedValue({ data: new Uint8Array([1]), defaultName: 'test.zip', mimeType: 'application/zip' })
  const wrapper = mount(Harness)
  try {
    await flushPromises()
    await ui.open(archive.id)
    const final = structuredClone(archive)
    if (change === 'identity')
      final.context.actorId = 'another-actor'
    if (change === 'hash')
      final.manifestHash = 'b'.repeat(64)
    if (change === 'private')
      final.context.capabilities = ['payroll:read']
    repository.workbookArchive.mockResolvedValueOnce(archive).mockResolvedValueOnce(final)
    await ui.download(change === 'private' ? 'private-zip' : 'xlsx')
    expect(ui.opened.value).toBeNull()
    expect(ui.error.value).toMatch(/身份|私密/)
    await expect(exportFile.mock.results.at(-1)!.value).rejects.toThrow()
  }
  finally {
    wrapper.unmount()
    plain.mockRestore()
    zipped.mockRestore()
  }
})
