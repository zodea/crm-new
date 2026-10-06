import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import CrewWorkerMigrationPanel from '~/components/migration/CrewWorkerMigrationPanel.vue'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { useProductionAccessStore } from '~/stores/production-access'

const host = vi.hoisted(() => ({ native: false, exportSnapshot: vi.fn(), inspect: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => host.native }))
vi.mock('~/lib/db/native-snapshot', () => ({ createNativeMigrationSnapshot: host.exportSnapshot, inspectNativeMigrationSnapshot: host.inspect }))
const fetch = vi.fn()
const context = { workspaceId: 'migration-workspace', actorId: 'migration-owner', capabilities: ['core:migration:write', 'worker:sensitive:read', 'worker:list:read', 'crew:list:read'] }
const sourceSha = 'a'.repeat(64)
const pending = { workspaceId: context.workspaceId, actorId: context.actorId, family: 'crew-worker-import', targetId: null, action: 'adopt', commandId: 'original-cw-adoption' }
const recoveryKey = commandRecoveryKey(pending)
const receipt = { commandId: pending.commandId, sourceSha256: sourceSha, schemaVersion: 57, crewIds: ['native-crew'], workerIds: ['native-worker'], originalCount: 1, archiveIds: ['native-archive'], adoptedAt: '2026-10-05T00:00:00.000Z' }
const sources = [{ source_sha256: sourceSha, schema_version: 57, created_at: receipt.adoptedAt }]
const state = (adopted = false) => ({ context, references: [], sources: adopted ? sources : [] })
let pinia: ReturnType<typeof createPinia>
let access = { mode: 'production' as const, authenticated: true, ownerId: context.actorId, purpose: 'verification' as const }
const mount = () => render(CrewWorkerMigrationPanel, { global: { plugins: [pinia], stubs: { NuxtLink: { template: '<a><slot /></a>' } } } })

beforeEach(async () => {
  localStorage.clear()
  host.native = false
  fetch.mockReset()
  host.exportSnapshot.mockReset()
  host.inspect.mockReset()
  vi.stubGlobal('$fetch', fetch)
  pinia = createPinia()
  access = { mode: 'production', authenticated: true, ownerId: context.actorId, purpose: 'verification' }
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionAccess: { status: async () => ({ ...access }) } } }))
  await useProductionAccessStore(pinia).check()
})

it('刷新后通过独立原键核对及真实来源读回恢复，不保存私密正文或重执行原迁入', async () => {
  createCommandRecoveryStorage(() => localStorage).remember(recoveryKey, pending)
  fetch.mockImplementation(async (url: string) => url.endsWith('/resolve') ? { outcome: 'applied', result: receipt } : state(true))
  mount()
  const button = await screen.findByRole('button', { name: '核对原工人班组迁入' })
  expect((screen.getByLabelText('选择桌面导出的 SQLite 一致快照') as HTMLInputElement).disabled).toBe(true)
  await fireEvent.click(button)
  expect((await screen.findByTestId('crew-worker-import-result')).textContent).toContain('已采用 1 个班组、1 个工人')
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/resolve'))).toEqual([['/api/commands/crew-worker/import/resolve', { method: 'POST', body: { commandId: pending.commandId } }]])
  expect(fetch.mock.calls.filter(([url]) => url === '/api/commands/crew-worker/import')).toHaveLength(0)
  expect(localStorage.getItem(recoveryKey)).toBeNull()
})

it('首次采用只持久化六个恢复字段，未知写响应后重新挂载仍按原键核对且不再写入', async () => {
  const adoptions: Array<{ commandId: string }> = []
  const resolutions: Array<{ commandId: string }> = []
  const preview = { sourceSha256: sourceSha, schemaVersion: 57, workers: [{ id: 'native-worker', name: '原私密工人姓名', deleted: false }], crews: [{ id: 'native-crew', name: '原班组', deleted: false }], projects: [], originalCount: 1, archiveCount: 1, eligible: true, blockingReasons: [] }
  let adopted = false
  host.inspect.mockResolvedValue({ sha256: sourceSha, schemaVersion: 57 })
  fetch.mockImplementation(async (url: string, options?: { body: { action?: string, commandId: string } }) => {
    if (url.endsWith('/resolve')) {
      resolutions.push(options!.body)
      return { outcome: 'applied', result: { ...receipt, commandId: adoptions[0]!.commandId } }
    }
    if (url === '/api/commands/crew-worker/import') {
      if (options!.body.action === 'preflight')
        return preview
      adoptions.push(options!.body)
      adopted = true
      throw new Error('提交结果未知，请核对原提交编号。')
    }
    return state(adopted)
  })
  const view = mount()
  const input = await screen.findByLabelText('选择桌面导出的 SQLite 一致快照') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  const file = new File([new Uint8Array([1, 2, 3])], 'original-native.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  await fireEvent.change(input, { target: { files: [file] } })
  const button = await screen.findByRole('button', { name: '采用核验后的工人、班组目录' }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(adoptions).toHaveLength(1))
  const literalKey = 'crm:form-command:v1:crew-worker-import:migration-workspace:migration-owner:new'
  const text = localStorage.getItem(literalKey)!
  const descriptor = JSON.parse(text)
  expect(descriptor).toEqual({ workspaceId: 'migration-workspace', actorId: 'migration-owner', family: 'crew-worker-import', targetId: null, action: 'adopt', commandId: adoptions[0]!.commandId })
  expect(Object.keys(descriptor).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'targetId', 'workspaceId'])
  expect(descriptor.commandId).toMatch(/^cw-import-[\da-f-]{36}$/)
  expect(text).not.toContain('capabilities')
  expect(text).not.toContain('原私密工人姓名')
  expect(text).not.toContain('payloadBase64')
  expect(text).not.toContain('referenceMappings')
  expect(createCommandRecoveryStorage(() => localStorage).read(literalKey)).toEqual(descriptor)
  expect((await screen.findByRole('alert')).textContent).toContain('提交结果未知')
  view.unmount()
  mount()
  await fireEvent.click(await screen.findByRole('button', { name: '核对原工人班组迁入' }))
  expect((await screen.findByTestId('crew-worker-import-result')).textContent).toContain('已采用 1 个班组、1 个工人')
  expect(resolutions).toEqual([{ commandId: descriptor.commandId }])
  expect(adoptions).toHaveLength(1)
  expect(localStorage.getItem(literalKey)).toBeNull()
})

it('未知响应或错误原编号不清除原描述，失权或换操作者时不泄露旧结果', async () => {
  createCommandRecoveryStorage(() => localStorage).remember(recoveryKey, pending)
  fetch.mockImplementation(async (url: string) => url.endsWith('/resolve') ? { outcome: 'not-applied', commandId: 'another-command' } : state())
  mount()
  await fireEvent.click(await screen.findByRole('button', { name: '核对原工人班组迁入' }))
  expect((await screen.findByRole('alert')).textContent).toContain('没有确认原编号')
  expect(JSON.parse(localStorage.getItem(recoveryKey)!)).toEqual(pending)
  fetch.mockResolvedValue({ ...state(), context: { ...context, actorId: 'different-owner' } })
  await fireEvent.click(screen.getByRole('button', { name: '核对原工人班组迁入' }))
  expect((await screen.findByRole('alert')).textContent).toContain('操作者或权限已变化')
  expect(screen.queryByTestId('crew-worker-import-recovery')).toBeNull()
  expect(screen.queryByTestId('crew-worker-import-result')).toBeNull()
  expect(JSON.parse(localStorage.getItem(recoveryKey)!)).toEqual(pending)
})

it('native 显式导出取消后不切换来源、不生成中央身份或自动上传', async () => {
  host.native = true
  host.exportSnapshot.mockResolvedValue(null)
  mount()
  const button = screen.getByRole('button', { name: '导出当前数据库一致快照' }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(host.exportSnapshot).toHaveBeenCalledOnce())
  expect(fetch).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
})

it('授权与实际读取来源字段损坏时禁用新迁入，并保留已有恢复描述', async () => {
  createCommandRecoveryStorage(() => localStorage).remember(recoveryKey, pending)
  fetch.mockResolvedValue({ ...state(), sources: [{ ...sources[0], source_sha256: 'unverified' }] })
  mount()
  expect((await screen.findByRole('alert')).textContent).toContain('读取来源不完整')
  expect((screen.getByLabelText('选择桌面导出的 SQLite 一致快照') as HTMLInputElement).disabled).toBe(true)
  expect(JSON.parse(localStorage.getItem(recoveryKey)!)).toEqual(pending)
  expect(fetch).toHaveBeenCalledOnce()
})

function delayed<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => resolve = done)
  return { promise, resolve }
}
async function loseAccess() {
  access = { ...access, authenticated: false }
  await useProductionAccessStore(pinia).check()
}
it('真实权限事件即时隐藏旧事实，迟到原键核对响应不显示结果也不清原key', async () => {
  const late = delayed<unknown>()
  createCommandRecoveryStorage(() => localStorage).remember(recoveryKey, pending)
  fetch.mockImplementation(async (url: string) => url.endsWith('/resolve') ? late.promise : state(true))
  mount()
  await fireEvent.click(await screen.findByRole('button', { name: '核对原工人班组迁入' }))
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/resolve'))).toBe(true))
  await loseAccess()
  expect(screen.queryByTestId('crew-worker-import-recovery')).toBeNull()
  late.resolve({ outcome: 'applied', result: receipt })
  await flushPromises()
  expect(screen.queryByTestId('crew-worker-import-result')).toBeNull()
  expect(JSON.parse(localStorage.getItem(recoveryKey)!)).toEqual(pending)
})
it('迟到已保存结果的后读不能跨权限事件清除原key；恢复原授权后已知原结果只GET读回', async () => {
  const lateRead = delayed<unknown>()
  let reads = 0
  createCommandRecoveryStorage(() => localStorage).remember(recoveryKey, pending)
  fetch.mockImplementation(async (url: string) => url.endsWith('/resolve') ? { outcome: 'applied', result: receipt } : ++reads === 3 ? lateRead.promise : state(true))
  mount()
  await fireEvent.click(await screen.findByRole('button', { name: '核对原工人班组迁入' }))
  await waitFor(() => expect(reads).toBe(3))
  await loseAccess()
  lateRead.resolve(state(true))
  await flushPromises()
  expect(localStorage.getItem(recoveryKey)).not.toBeNull()
  expect(screen.queryByTestId('crew-worker-import-result')).toBeNull()
  access = { ...access, authenticated: true }
  await useProductionAccessStore(pinia).check()
  await fireEvent.click(screen.getByRole('button', { name: '重新读取迁入权限与状态' }))
  await fireEvent.click(await screen.findByRole('button', { name: '核对原工人班组迁入' }))
  expect(await screen.findByTestId('crew-worker-import-result')).not.toBeNull()
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/resolve'))).toHaveLength(1)
  expect(localStorage.getItem(recoveryKey)).toBeNull()
})
it('组件卸载后原核对响应不清存储或发起后读，下一次仍能定位原命令', async () => {
  const late = delayed<unknown>()
  createCommandRecoveryStorage(() => localStorage).remember(recoveryKey, pending)
  fetch.mockImplementation(async (url: string) => url.endsWith('/resolve') ? late.promise : state(true))
  const view = mount()
  await fireEvent.click(await screen.findByRole('button', { name: '核对原工人班组迁入' }))
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/resolve'))).toBe(true))
  const count = fetch.mock.calls.length
  view.unmount()
  late.resolve({ outcome: 'applied', result: receipt })
  await flushPromises()
  expect(fetch.mock.calls).toHaveLength(count)
  expect(JSON.parse(localStorage.getItem(recoveryKey)!)).toEqual(pending)
})
it('预检迟到时权限事件不发布旧工人姓名，原来源输入保留并需在原身份下重新核验', async () => {
  const late = delayed<unknown>()
  host.inspect.mockResolvedValue({ sha256: sourceSha, schemaVersion: 57 })
  fetch.mockImplementation(async (url: string) => url === '/api/commands/crew-worker/import' ? late.promise : state())
  mount()
  const input = await screen.findByLabelText('选择桌面导出的 SQLite 一致快照') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  const file = new File([new Uint8Array([1, 2, 3])], 'original-native.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  await fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/api/commands/crew-worker/import')).toBe(true))
  await loseAccess()
  late.resolve({ sourceSha256: sourceSha, schemaVersion: 57, workers: [{ id: 'old-private-worker', name: '原私密姓名', deleted: false }], crews: [], projects: [], originalCount: 0, archiveCount: 0, eligible: true, blockingReasons: [] })
  await flushPromises()
  expect(screen.queryByText('原私密姓名')).toBeNull()
  expect(screen.queryByRole('button', { name: '采用核验后的工人、班组目录' })).toBeNull()
  expect(localStorage.length).toBe(0)
  access = { ...access, authenticated: true }
  await useProductionAccessStore(pinia).check()
  await fireEvent.click(screen.getByRole('button', { name: '重新读取迁入权限与状态' }))
  expect(await screen.findByRole('button', { name: '重新核对来源与项目' })).not.toBeNull()
  expect(screen.getByText(`来源 SHA-256：${sourceSha}`)).not.toBeNull()
})
