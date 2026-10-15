import type { ProductionAccessStatus } from '~/lib/customer/access-repository'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import QuotationImportPage from '~/components/material/quotation/QuotationImportPage.vue'
import OtherSettlementImportPage from '~/components/other-settlement/OtherSettlementImportPage.vue'
import CommandRecoveryPanel from '~/components/shared/CommandRecoveryPanel.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import KitButton from '~/components/ui/KitButton.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { auxiliaryProblem } from '~/lib/auxiliary-contract/contract'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { createOtherSettlementRepository } from '~/lib/other-settlement/repository'
import { useProductionAccessStore } from '~/stores/production-access'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
  for (const name of ['computed', 'ref', 'shallowRef', 'watch', 'onMounted', 'onActivated', 'onDeactivated', 'onBeforeUnmount'] as const)
    vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn(async () => true) }))
  vi.stubGlobal('navigateTo', vi.fn())
})
afterEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

function actualHttpFailure(status: 401 | 403) {
  return Object.assign(new Error(`Actual HTTP ${status}`), { response: new Response('invalid public problem body', { status }) })
}

async function fixture(kind: 'quotation' | 'other') {
  const actor = { workspaceId: 'actual-workspace', actorId: 'actual-owner', capabilities: ['material-quotation:read', 'material-quotation:write', 'other-settlement:read', 'other-settlement:write', 'core:migration:write'] }
  let contextActor = actor
  const family = kind === 'quotation' ? 'material-quotation-import' : 'other-settlement-import'
  const descriptor = { workspaceId: actor.workspaceId, actorId: actor.actorId, family, targetId: null, commandId: 'original-import-key', action: 'import' }
  const key = commandRecoveryKey(descriptor)
  createCommandRecoveryStorage().remember(key, descriptor)
  const result = kind === 'quotation'
    ? { commandId: descriptor.commandId, batchId: 'original-batch', graphHash: 'a'.repeat(64), importedIds: ['original-quotation'], updatedAt: '2026-10-05T00:00:00.000Z' }
    : { commandId: descriptor.commandId, sourceBytesSha256: 'b'.repeat(64), graphHash: 'a'.repeat(64), ids: ['original-settlement'], fileIds: ['original-file'], importedAt: '2026-10-05T00:00:00.000Z' }
  const root = kind === 'quotation' ? 'material-quotations' : 'other-settlements'
  const contextUrl = `/api/read/${root}/${kind === 'quotation' ? 'import-context' : 'context'}`
  const calls: Array<{ url: string, method: string }> = []
  let afterResolveContextFailure = false
  let armContextFailure = false
  let failNextList = false
  let heldResolve: Promise<unknown> | null = null
  let heldContext: Promise<unknown> | null = null
  let httpFailure: { status: 401 | 403, target: 'context' | 'imports' } | null = null
  let accessStatus: ProductionAccessStatus = { mode: 'production', authenticated: true, purpose: 'verification', ownerId: actor.actorId, expiresAt: '2026-10-06T00:00:00.000Z' }
  const envelope = (schemaVersion: string, body: object, session = actor) => withReadMeta(body, createReadMeta({ session, schemaVersion, operation: `${kind}:import-recovery-test`, dataOrigin: 'real', asOf: '2026-10-05T00:00:00.000Z', coverage: 'complete', scope: {}, sources: [{ key: root, state: 'readable', sourceVersion: 'actual-revision-1', asOf: '2026-10-05T00:00:00.000Z' }] }))
  const fetcher = vi.fn(async (url: string, options?: { method?: string }): Promise<unknown> => {
    calls.push({ url, method: options?.method ?? 'GET' })
    if (url === contextUrl) {
      if (heldContext) {
        const response = heldContext
        heldContext = null
        return response
      }
      if (httpFailure?.target === 'context') {
        const { status } = httpFailure
        httpFailure = null
        throw actualHttpFailure(status)
      }
      if (afterResolveContextFailure) {
        afterResolveContextFailure = false
        throw auxiliaryProblem('unavailable', '后置会话读取失败')
      }
      return kind === 'quotation'
        ? envelope('material-quotation-import-context-v1', { workspaceId: contextActor.workspaceId, actorId: contextActor.actorId, references: [] }, contextActor)
        : envelope('other-settlement-read-v1', { workspaceId: contextActor.workspaceId, actorId: contextActor.actorId, projects: [], suppliers: [], workers: [], contracts: [] }, contextActor)
    }
    if (url === `/api/commands/${root}/import/resolve`) {
      if (heldResolve)
        return heldResolve
      if (armContextFailure)
        afterResolveContextFailure = true
      return { outcome: 'applied', result }
    }
    if (url === `/api/read/${root}/imports`) {
      if (httpFailure?.target === 'imports') {
        const { status } = httpFailure
        httpFailure = null
        throw actualHttpFailure(status)
      }
      if (failNextList) {
        failNextList = false
        throw auxiliaryProblem('unavailable', '迁入证据读取失败')
      }
      return envelope(kind === 'quotation' ? 'material-quotation-import-read-v1' : 'other-settlement-read-v1', { records: [result] })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('$fetch', fetcher)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { otherSettlements: createOtherSettlementRepository(fetcher), productionAccess: { status: async () => accessStatus } } }))
  const access = useProductionAccessStore()
  await access.check()
  return {
    calls,
    key,
    descriptor,
    result,
    armFailure() { armContextFailure = true },
    failList() { failNextList = true },
    failHttp(status: 401 | 403, target: 'context' | 'imports') { httpFailure = { status, target } },
    holdContext(response: Promise<unknown>) { heldContext = response },
    contextChange(change: 'identity' | 'permission' | null) {
      contextActor = change === 'identity'
        ? { ...actor, workspaceId: 'another-actual-workspace', actorId: 'another-actual-owner' }
        : change === 'permission'
          ? { ...actor, capabilities: actor.capabilities.filter(capability => capability !== (kind === 'quotation' ? 'material-quotation:write' : 'other-settlement:write')) }
          : actor
    },
    holdResolve(value: Promise<unknown> | null) { heldResolve = value },
    async authentication(authenticated: boolean) {
      accessStatus = { mode: 'production', authenticated, purpose: 'verification', ...(authenticated ? { ownerId: actor.actorId, expiresAt: '2026-10-06T00:00:00.000Z' } : {}) }
      await access.check()
    },
    open: () => mount(kind === 'quotation' ? QuotationImportPage : OtherSettlementImportPage, { global: { components: { EntityFormShell, CommandRecoveryPanel, KitButton, StatePanel }, stubs: { SectionHeader: true, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } }),
  }
}

it.each(['quotation', 'other'] as const)('%s resolve已证明保存后会话GET失败，恢复只GET而不重发或再resolve', async (kind) => {
  const f = await fixture(kind)
  f.armFailure()
  const wrapper = f.open()
  await flushPromises()
  expect(wrapper.text()).toContain('后置会话读取失败')
  expect(wrapper.text()).not.toContain('已保存待刷新')
  expect(f.calls.filter(call => call.method === 'POST')).toEqual([{ url: `/api/commands/${kind === 'quotation' ? 'material-quotations' : 'other-settlements'}/import/resolve`, method: 'POST' }])
  expect(createCommandRecoveryStorage().read(f.key)).toEqual(f.descriptor)
  await f.authentication(false)
  await f.authentication(true)
  expect(wrapper.text()).not.toContain('已保存待刷新')
  expect(createCommandRecoveryStorage().read(f.key)).toEqual(f.descriptor)
  const recover = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '核对原提交' : '重新核对会话'))!
  await recover.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(1)
  expect(createCommandRecoveryStorage().read(f.key)).toBeNull()
})

it.each([
  ['quotation', 'identity'],
  ['quotation', 'permission'],
  ['other', 'identity'],
  ['other', 'permission'],
] as const)('%s 已公开saved后GET发现%s变化，撤下公开结果而原身份恢复只GET', async (kind, change) => {
  const f = await fixture(kind)
  f.failList()
  const wrapper = f.open()
  await flushPromises()
  expect(wrapper.text()).toContain('已保存待刷新')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(1)
  f.contextChange(change)
  const recover = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '重新读取已保存记录' : '核对原迁入'))!
  await recover.trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('已保存待刷新')
  expect(wrapper.text()).not.toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  if (kind === 'quotation')
    expect(wrapper.getComponent(CommandRecoveryPanel).props('saved')).toBe(false)
  expect(useProductionAccessStore().status).toMatchObject({ mode: 'production', authenticated: true, ownerId: 'actual-owner' })
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(1)
  expect(createCommandRecoveryStorage().read(f.key)).toEqual(f.descriptor)
  f.contextChange(null)
  const restore = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '核对原提交' : '重新核对会话'))!
  await restore.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(2)
  expect(createCommandRecoveryStorage().read(f.key)).toBeNull()
})

it.each(['quotation', 'other'] as const)('%s 真实访问撤权使迟到resolve不可显示或清号；恢复原身份仍核对原键', async (kind) => {
  const f = await fixture(kind)
  let release!: (value: unknown) => void
  f.holdResolve(new Promise(resolve => release = resolve))
  const wrapper = f.open()
  await flushPromises()
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  await f.authentication(false)
  release({ outcome: 'applied', result: f.result })
  await flushPromises()
  expect(wrapper.text()).not.toContain('已保存待刷新')
  expect(wrapper.text()).not.toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(f.calls.some(call => call.url.endsWith('/imports'))).toBe(false)
  expect(createCommandRecoveryStorage().read(f.key)).toEqual(f.descriptor)
  f.holdResolve(null)
  await f.authentication(true)
  const recover = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '核对原提交' : '重新核对会话'))!
  await recover.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(f.calls.filter(call => call.method === 'POST')).toEqual([
    { url: `/api/commands/${kind === 'quotation' ? 'material-quotations' : 'other-settlements'}/import/resolve`, method: 'POST' },
    { url: `/api/commands/${kind === 'quotation' ? 'material-quotations' : 'other-settlements'}/import/resolve`, method: 'POST' },
  ])
  expect(createCommandRecoveryStorage().read(f.key)).toBeNull()
})

it.each(['quotation', 'other'] as const)('%s 已公开saved后证据GET失败，撤权撤下公开结果而私有证明仅供原身份GET恢复', async (kind) => {
  const f = await fixture(kind)
  f.failList()
  const wrapper = f.open()
  await flushPromises()
  expect(wrapper.text()).toContain('已保存待刷新')
  expect(wrapper.text()).toContain('迁入证据读取失败')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(1)
  await f.authentication(false)
  await flushPromises()
  expect(wrapper.text()).not.toContain('已保存待刷新')
  if (kind === 'quotation')
    expect(wrapper.getComponent(CommandRecoveryPanel).props('saved')).toBe(false)
  expect(createCommandRecoveryStorage().read(f.key)).toEqual(f.descriptor)
  await f.authentication(true)
  const recover = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '核对原提交' : '重新核对会话'))!
  await recover.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(2)
  expect(createCommandRecoveryStorage().read(f.key)).toBeNull()
})

it.each([
  ['quotation', 401, 'context'],
  ['quotation', 403, 'imports'],
  ['other', 401, 'context'],
  ['other', 403, 'imports'],
] as const)('%s 已公开saved后真实HTTP %s拒绝%s，撤下结果保原证明，原会话只GET恢复', async (kind, status, target) => {
  const f = await fixture(kind)
  f.failList()
  const wrapper = f.open()
  await flushPromises()
  expect(wrapper.text()).toContain('已保存待刷新')
  f.failHttp(status, target)
  const recover = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '重新读取已保存记录' : '核对原迁入'))!
  await recover.trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('已保存待刷新')
  expect(wrapper.text()).not.toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(wrapper.text()).toContain(status === 401 ? '登录已失效' : '当前没有查看或执行此操作的权限')
  if (kind === 'quotation')
    expect(wrapper.getComponent(CommandRecoveryPanel).props('saved')).toBe(false)
  expect(useProductionAccessStore().status).toMatchObject({ mode: 'production', authenticated: true, ownerId: 'actual-owner' })
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(status === 401 ? 1 : 2)
  expect(createCommandRecoveryStorage().read(f.key)).toEqual(f.descriptor)
  const restore = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '核对原提交' : '重新核对会话'))!
  await restore.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(status === 401 ? 2 : 3)
  expect(createCommandRecoveryStorage().read(f.key)).toBeNull()
})

it.each(['quotation', 'other'] as const)('%s 迟到旧代真实401不能撤下新代已核验结果', async (kind) => {
  const f = await fixture(kind)
  f.failList()
  const wrapper = f.open()
  await flushPromises()
  expect(wrapper.text()).toContain('已保存待刷新')
  let reject!: (cause: unknown) => void
  f.holdContext(new Promise((_, fail) => reject = fail))
  const recover = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '重新读取已保存记录' : '核对原迁入'))!
  await recover.trigger('click')
  await flushPromises()
  await f.authentication(false)
  await f.authentication(true)
  const restore = wrapper.findAll('button').find(button => button.text() === (kind === 'quotation' ? '核对原提交' : '重新核对会话'))!
  await restore.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  reject(actualHttpFailure(401))
  await flushPromises()
  expect(wrapper.text()).toContain(kind === 'quotation' ? '报价迁入已保存并核验读取' : '原图已保存并读取核验。')
  expect(wrapper.text()).not.toContain('登录已失效')
  expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  expect(f.calls.filter(call => call.url.endsWith('/imports'))).toHaveLength(2)
  expect(createCommandRecoveryStorage().read(f.key)).toBeNull()
})
