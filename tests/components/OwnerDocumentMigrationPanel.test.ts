import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { ownerDocumentMigrationDescriptor } from '~/lib/owner-document/production-migration'
import OwnerDocumentMigrationPanel from '~/pages/settings/_components/OwnerDocumentMigrationPanel.vue'

vi.mock('~/composables/useKitUI', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/composables/useKitUI')>()
  return { ...original, useKitUI: () => ({ confirm: original.confirm }) }
})

const fetch = vi.fn()
const identity = { workspaceId: 'business-import-workspace', actorId: 'business-import-owner' }
const descriptor = ownerDocumentMigrationDescriptor({ ...identity, commandId: 'business-original-key', sourceSha256: 'a'.repeat(64) })
const result = { ...identity, commandId: descriptor.commandId, sourceSha256: descriptor.scopeId, importId: 'business-original-import', documentIds: ['original-acceptance'], restored: false }
const state = { ...identity, capabilities: ['owner-document:import'], sources: [{ importId: result.importId, sourceSha256: result.sourceSha256, importedAt: '2026-10-07T00:00:00.000Z', restored: false, original: result }] }
beforeEach(() => {
  sessionStorage.clear()
  fetch.mockReset()
  vi.stubGlobal('$fetch', fetch)
})
it('商务迁入冷页恢复只携原定位，后读失败保marker，确认已应用后只再读', async () => {
  const recovery = createCommandRecoveryStorage(() => sessionStorage)
  const key = commandRecoveryKey(descriptor)
  recovery.remember(key, descriptor)
  let postReadFails = false
  fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/resolve')) {
      postReadFails = true
      return { outcome: 'applied', result }
    }
    if (postReadFails) {
      postReadFails = false
      throw new Error('商务已应用但后读失败')
    }
    return state
  })
  render(OwnerDocumentMigrationPanel, { global: { plugins: [createPinia()] } })
  await screen.findByRole('button', { name: '核对原商务接管提交' })
  expect((screen.getByLabelText('商务 SQLite 原库') as HTMLInputElement).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '核对原商务接管提交' }))
  expect((await screen.findByRole('alert')).textContent).toContain('后读失败')
  expect(recovery.read(key)).toEqual(descriptor)
  await fireEvent.click(screen.getByRole('button', { name: '重试读取已应用结果' }))
  await waitFor(() => expect(recovery.read(key)).toBeNull())
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/resolve'))).toHaveLength(1)
  expect(fetch.mock.calls.filter(([url, options]) => options?.method === 'POST' && !url.endsWith('/resolve'))).toEqual([])
  expect(screen.getByText('商务原图已接管并可靠读取。')).not.toBeNull()
  expect(sessionStorage.getItem(key)).toBeNull()
})
it('错误来源/身份回执不清原key、不允许重发正文；当前身份不同停止候选资格', async () => {
  const recovery = createCommandRecoveryStorage(() => sessionStorage)
  const key = commandRecoveryKey(descriptor)
  recovery.remember(key, descriptor)
  fetch.mockImplementation(async (url: string) => url.endsWith('/resolve') ? { outcome: 'applied', result: { ...result, sourceSha256: 'b'.repeat(64) } } : state)
  render(OwnerDocumentMigrationPanel, { global: { plugins: [createPinia()] } })
  await screen.findByRole('button', { name: '核对原商务接管提交' })
  await fireEvent.click(screen.getByRole('button', { name: '核对原商务接管提交' }))
  expect((await screen.findByRole('alert')).textContent).toContain('原编号')
  expect(recovery.read(key)).toEqual(descriptor)
  expect(sessionStorage.getItem(key)).not.toMatch(/draft|payloadBase64|selections|originals/)
})

it('已应用后切换身份立即撤下旧事实与选择，只保原定位等待原身份恢复', async () => {
  const recovery = createCommandRecoveryStorage(() => sessionStorage)
  const key = commandRecoveryKey(descriptor)
  recovery.remember(key, descriptor)
  let switched = false
  fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/resolve')) {
      switched = true
      return { outcome: 'applied', result }
    }
    return switched ? { ...state, actorId: 'business-other-owner', sources: [] } : state
  })
  render(OwnerDocumentMigrationPanel, { global: { plugins: [createPinia()] } })
  await screen.findByRole('button', { name: '核对原商务接管提交' })
  await fireEvent.click(screen.getByRole('button', { name: '核对原商务接管提交' }))
  expect((await screen.findByRole('alert')).textContent).toContain('原工作区身份已变化')
  expect(screen.queryByLabelText('商务 SQLite 原库')).toBeNull()
  expect(recovery.read(key)).toEqual(descriptor)
})
