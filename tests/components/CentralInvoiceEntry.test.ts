import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import CentralInvoiceEntry from '~/components/invoice/CentralInvoiceEntry.vue'

const mocks = vi.hoisted(() => ({
  workspace: {},
  load: vi.fn(),
  signatories: vi.fn(),
  authority: null as null | ((problem: { message: string }) => void),
}))
vi.mock('~/lib/invoice/central-bootstrap', () => ({
  parseInvoiceSession: (value: unknown) => value,
  createInvoiceWorkspaceFromSession: async () => mocks.workspace,
}))
vi.mock('~/lib/invoice/central-migration-catalog', () => ({ createInvoiceWorkspaceCatalogClient: () => ({ load: mocks.load }) }))
vi.mock('~/lib/our-signatory/http-repository', () => ({ createOurSignatoryRepository: () => ({ list: mocks.signatories }) }))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (callback: typeof mocks.authority) => {
    mocks.authority = callback
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.signatories.mockReset()
  mocks.authority = null
})

it('目录缺口明确显示，传递真实候选；权限失效后撤下工作台', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.signatories.mockRejectedValue(new Error('无权限'))
  mocks.load.mockImplementation(async ([key]: [string]) => {
    if (key === 'suppliers')
      throw new Error('无权限')
    return { projects: key === 'projects' ? [{ id: 'project-one', label: '真实项目', version: '1', sourceVersion: 'projects:1' }] : [], suppliers: [], contracts: [] }
  })
  const stub = defineComponent({ name: 'WorkspaceStub', props: ['workspace', 'projects', 'suppliers', 'contracts'], template: '<div>工作台已加载</div>' })
  const wrapper = mount(CentralInvoiceEntry, { props: { mode: 'workspace' }, global: { stubs: { CentralInvoiceWorkspaceScreen: stub } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('工作台已加载'))
  expect(wrapper.text()).toContain('分供方')
  expect(wrapper.findComponent(stub).props('projects')).toMatchObject([{ id: 'project-one', label: '真实项目' }])
  expect(wrapper.findComponent(stub).props('suppliers')).toEqual([])
  mocks.authority?.({ message: '身份已变化' })
  await nextTick()
  expect(wrapper.text()).toContain('身份已变化')
  expect(wrapper.text()).not.toContain('工作台已加载')
  wrapper.unmount()
})

it('只在完整可读且身份一致时展示我方主体的真实版本', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'our-signatory:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.load.mockResolvedValue({ projects: [], suppliers: [], contracts: [] })
  mocks.signatories.mockResolvedValue({ records: [{ id: 'buyer-one', version: '2', draft: { name: '合成购方', status: 'active' } }], meta: { ...actor, authorizedScope: { coverage: 'complete' }, sources: [{ key: 'our-signatories', state: 'readable', sourceVersion: 'our-signatories-2' }] } })
  const stub = defineComponent({ name: 'WorkspaceStub', props: ['workspace', 'projects', 'suppliers', 'signatories', 'contracts'], template: '<div>工作台已加载</div>' })
  const wrapper = mount(CentralInvoiceEntry, { props: { mode: 'workspace' }, global: { stubs: { CentralInvoiceWorkspaceScreen: stub } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('工作台已加载'))
  expect(wrapper.findComponent(stub).props('signatories')).toEqual([{ id: 'buyer-one', label: '合成购方', version: '2' }])
  wrapper.unmount()
})
