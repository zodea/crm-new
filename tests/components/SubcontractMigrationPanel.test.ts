import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import SubcontractMigrationPanel from '~/pages/settings/_components/SubcontractMigrationPanel.vue'

vi.mock('~/composables/useKitUI', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/composables/useKitUI')>()
  return { ...original, useKitUI: () => ({ confirm: original.confirm }) }
})
const fetch = vi.fn()
const context = { workspaceId: 'sub-import-workspace', actorId: 'sub-import-owner', capabilities: ['subcontract-contract:read', 'subcontract-contract:import'] }
const descriptor = { ...context, capabilities: undefined, commandId: 'sub-original-adopt', family: 'subcontract-contract-import', targetId: null, action: 'adopt', scopeId: 'a'.repeat(64) }
const marker = { commandId: descriptor.commandId, workspaceId: context.workspaceId, actorId: context.actorId, family: descriptor.family, targetId: null, action: descriptor.action, scopeId: descriptor.scopeId }
const result = { commandId: marker.commandId, importId: 'subcontract-import-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sourceSha256: marker.scopeId, ids: ['original-sub'], supplementIds: ['original-supp'] }
const state = { context, sources: [{ importId: result.importId, sourceSha256: result.sourceSha256, ids: result.ids, supplementIds: result.supplementIds, importedAt: '2026-10-07T00:00:00.000Z', restored: false }] }
beforeEach(() => {
  sessionStorage.clear()
  fetch.mockReset()
  vi.stubGlobal('$fetch', fetch)
})
it('分包冷页原号无正文恢复；已应用后读失败保marker，只再读不再resolve或adopt', async () => {
  const recovery = createCommandRecoveryStorage(() => sessionStorage)
  const key = commandRecoveryKey(marker)
  recovery.remember(key, marker)
  let postReadFails = false
  fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/resolve')) {
      postReadFails = true
      return { outcome: 'applied', result }
    }
    if (postReadFails) {
      postReadFails = false
      throw new Error('保存后读取暂时失败')
    }
    return state
  })
  render(SubcontractMigrationPanel, { global: { plugins: [createPinia()] } })
  await screen.findByRole('button', { name: '核对原分包接管提交' })
  expect((screen.getByLabelText('分包 SQLite 原库') as HTMLInputElement).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '核对原分包接管提交' }))
  expect((await screen.findByRole('alert')).textContent).toContain('保存后读取暂时失败')
  expect(recovery.read(key)).toEqual(marker)
  fetch.mockImplementation(async () => state)
  await fireEvent.click(screen.getByRole('button', { name: '核对原分包接管提交' }))
  await waitFor(() => expect(recovery.read(key)).toBeNull())
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/resolve'))).toHaveLength(1)
  expect(fetch.mock.calls.filter(([url, options]) => options?.method === 'POST' && !url.endsWith('/resolve'))).toEqual([])
  expect(screen.getByText('分包主补图已接管并可靠读取。')).not.toBeNull()
})
it('错误来源scope回执不能清原键、不能借文件或映射正文重发', async () => {
  const recovery = createCommandRecoveryStorage(() => sessionStorage)
  const key = commandRecoveryKey(marker)
  recovery.remember(key, marker)
  fetch.mockImplementation(async (url: string) => url.endsWith('/resolve') ? { outcome: 'applied', result: { ...result, sourceSha256: 'b'.repeat(64) } } : state)
  render(SubcontractMigrationPanel, { global: { plugins: [createPinia()] } })
  await screen.findByRole('button', { name: '核对原分包接管提交' })
  await fireEvent.click(screen.getByRole('button', { name: '核对原分包接管提交' }))
  expect((await screen.findByRole('alert')).textContent).toContain('原采用回执、来源定位或动作不一致')
  expect(recovery.read(key)).toEqual(marker)
  expect(sessionStorage.getItem(key)).not.toMatch(/draft|payloadBase64|supplier|mapping/)
})
