import { webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useKitUIHostState } from '~/composables/useKitUI'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import PayrollMigrationPanel from '~/pages/settings/_components/PayrollMigrationPanel.vue'
import { useProductionAccessStore } from '~/stores/production-access'

vi.mock('~/composables/useKitUI', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/composables/useKitUI')>()
  return { ...original, useKitUI: () => ({ confirm: original.confirm }) }
})
const fetch = vi.fn()
const context = { workspaceId: 'payroll-migration-workspace', actorId: 'payroll-migration-owner', capabilities: ['payroll:read', 'payroll:write', 'core:migration:write', 'worker:sensitive:read', 'worker:list:read', 'crew:list:read', 'project:list:read'] }
const sha = 'a'.repeat(64)
const marker = { workspaceId: context.workspaceId, actorId: context.actorId, family: 'payroll-import', commandId: 'original-payroll-adopt', action: 'adopt', targetId: null, scopeId: sha }
const result = { commandId: marker.commandId, sourceSha256: sha, projectIds: ['current-project'], statementIds: ['old-wage'], adoptedAt: '2026-10-07T00:00:00.000Z', retainedCoordination: true }
const state = (adopted = false) => ({ context, references: [{ entityType: 'workers', serverId: 'hidden-worker', label: '历史工人', version: '2', sourceVersion: 'worker-original-version', deleted: true }], sources: adopted ? [{ sourceSha256: sha, schemaVersion: 60, adoptedAt: result.adoptedAt }] : [] })
beforeEach(() => {
  sessionStorage.clear()
  fetch.mockReset()
  vi.stubGlobal('$fetch', fetch)
  vi.stubGlobal('crypto', webcrypto)
})
async function open() {
  const view = render(PayrollMigrationPanel, { global: { plugins: [createPinia()] } })
  await fireEvent.click(screen.getByText('完整工资 SQLite 迁入'))
  await fireEvent.click(await screen.findByRole('button', { name: '读取正式工资目录' }))
  await screen.findByLabelText('选择完整 SQLite 文件')
  return view
}
it('冷页只恢复原迁入编号；成功回执须在其后读取同一来源才能解除，不重发迁入', async () => {
  const recovery = createCommandRecoveryStorage(() => sessionStorage)
  const key = commandRecoveryKey(marker)
  recovery.remember(key, marker)
  let failRead = false
  fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('-resolve')) {
      failRead = true
      return { outcome: 'applied', result }
    }
    if (failRead) {
      failRead = false
      throw new Error('保存后读取暂时失败')
    }
    return state(true)
  })
  await open()
  expect((screen.getByLabelText('选择完整 SQLite 文件') as HTMLInputElement).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '核对原工资迁入' }))
  expect((await screen.findByRole('alert')).textContent).toContain('读取暂时失败')
  expect(recovery.read(key)).toEqual(marker)
  fetch.mockImplementation(async (url: string) => url.endsWith('-resolve') ? { outcome: 'applied', result } : state(true))
  await fireEvent.click(screen.getByRole('button', { name: '核对原工资迁入' }))
  await waitFor(() => expect(recovery.read(key)).toBeNull())
  expect(fetch.mock.calls.filter(([url]) => url === '/api/commands/payroll-import')).toEqual([])
  expect(screen.getByRole('status').textContent).toContain('工资原图已保存')
})
it('保留软删真实身份供显式历史映射；确认采用只存最小编号，未知结果冷页按原编号核对', async () => {
  let adopted: { commandId: string, source: { sha256: string }, referenceMappings: unknown[] } | null = null
  const preview = { sourceSha256: '', schemaVersion: 60, eligible: false, projects: [{ legacyId: 'original-project', label: '原项目' }], requiredReferences: [{ entityType: 'workers', legacyId: 'original-worker', label: '原工人' }], blockingReasons: ['原工人需明确映射'], diagnostics: [] }
  fetch.mockImplementation(async (url: string, options?: { body?: { action?: string, source?: { sha256: string }, referenceMappings?: unknown[] } }) => {
    if (url === '/api/commands/payroll-import') {
      if (options!.body!.action === 'preview')
        return { ...preview, sourceSha256: options!.body!.source!.sha256, eligible: options!.body!.referenceMappings!.length === 1 }
      adopted = options!.body as typeof adopted
      throw new Error('结果未知，请核对原编号')
    }
    return state()
  })
  const view = await open()
  const file = new File([new Uint8Array([1, 2, 3])], 'complete.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  await fireEvent.change(screen.getByLabelText('选择完整 SQLite 文件'), { target: { files: [file] } })
  const selector = await screen.findByRole('combobox')
  expect(screen.getByRole('option', { name: '历史工人 · hidden-worker（历史隐藏）' })).not.toBeNull()
  await fireEvent.update(selector, 'hidden-worker')
  await fireEvent.update(screen.getByLabelText('原身份核验依据'), '原身份证明及历史工资同一稳定身份')
  await fireEvent.click(screen.getByRole('button', { name: '重新核对完整原图与映射' }))
  const button = screen.getByRole('button', { name: '确认完整工资接管' }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  await fireEvent.click(button)
  await waitFor(() => expect(useKitUIHostState().confirmState.value).not.toBeNull())
  useKitUIHostState().resolveConfirm(true)
  await screen.findByRole('alert')
  await waitFor(() => expect(adopted).not.toBeNull())
  const original = adopted! as { commandId: string, source: { sha256: string } }
  const key = commandRecoveryKey(marker)
  const descriptor = JSON.parse(sessionStorage.getItem(key)!)
  expect(Object.keys(descriptor).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
  expect(sessionStorage.getItem(key)).not.toMatch(/payloadBase64|referenceMappings|hidden-worker|原身份证明/)
  view.unmount()
  const receipt = { ...result, commandId: original.commandId, sourceSha256: original.source.sha256 }
  fetch.mockImplementation(async (url: string) => url.endsWith('-resolve') ? { outcome: 'applied', result: receipt } : { ...state(), sources: [{ sourceSha256: receipt.sourceSha256, schemaVersion: 60, adoptedAt: receipt.adoptedAt }] })
  await open()
  await fireEvent.click(screen.getByRole('button', { name: '核对原工资迁入' }))
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull())
  expect(fetch.mock.calls.filter(([url, options]) => url === '/api/commands/payroll-import' && options.body.action === 'adopt')).toHaveLength(1)
})

it('正式权限在途失效后丢弃迟到目录并解除本地busy，恢复登录可重新读取且保原编号', async () => {
  let authenticated = true
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionAccess: { status: async () => ({ mode: 'production', authenticated, ownerId: context.actorId, purpose: 'verification' }) } } }))
  const pinia = createPinia()
  const access = useProductionAccessStore(pinia)
  await access.check()
  let finish!: (value: unknown) => void
  fetch.mockReturnValue(new Promise((resolve) => {
    finish = resolve
  }))
  const recovery = createCommandRecoveryStorage(() => sessionStorage)
  recovery.remember(commandRecoveryKey(marker), marker)
  render(PayrollMigrationPanel, { global: { plugins: [pinia] } })
  await fireEvent.click(screen.getByText('完整工资 SQLite 迁入'))
  await fireEvent.click(screen.getByRole('button', { name: '读取正式工资目录' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  authenticated = false
  await access.check()
  finish(state(true))
  await waitFor(() => expect((screen.getByRole('button', { name: '读取正式工资目录' }) as HTMLButtonElement).disabled).toBe(false))
  expect(screen.queryByLabelText('选择完整 SQLite 文件')).toBeNull()
  expect(recovery.read(commandRecoveryKey(marker))).toEqual(marker)
  authenticated = true
  await access.check()
  fetch.mockResolvedValue(state(true))
  await fireEvent.click(screen.getByRole('button', { name: '读取正式工资目录' }))
  await screen.findByLabelText('选择完整 SQLite 文件')
  expect(recovery.read(commandRecoveryKey(marker))).toEqual(marker)
})

it('完整原图核对在途时不能改映射或核验依据，迟到结果不会套到另一套输入', async () => {
  const preview = { schemaVersion: 60, eligible: false, projects: [{ legacyId: 'original-project', label: '原项目' }], requiredReferences: [{ entityType: 'workers', legacyId: 'original-worker', label: '原工人' }], blockingReasons: [], diagnostics: [] }
  let slow = false
  let finish!: () => void
  fetch.mockImplementation(async (url: string, options?: { body: { source: { sha256: string } } }) => {
    if (url === '/api/commands/payroll-import') {
      if (slow)
        await new Promise<void>((resolve) => { finish = resolve })
      return { ...preview, sourceSha256: options!.body.source.sha256 }
    }
    return state()
  })
  await open()
  const file = new File([new Uint8Array([1, 2, 3])], 'complete.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  await fireEvent.change(screen.getByLabelText('选择完整 SQLite 文件'), { target: { files: [file] } })
  const selector = await screen.findByRole('combobox') as HTMLSelectElement
  const note = screen.getByLabelText('原身份核验依据') as HTMLInputElement
  slow = true
  await fireEvent.click(screen.getByRole('button', { name: '重新核对完整原图与映射' }))
  await waitFor(() => expect(finish).toBeDefined())
  expect(selector.disabled).toBe(true)
  expect(note.disabled).toBe(true)
  finish()
  await waitFor(() => expect(selector.disabled).toBe(false))
})
