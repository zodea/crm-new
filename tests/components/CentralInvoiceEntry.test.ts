import { flushPromises, mount } from '@vue/test-utils'
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

it('台账区分项目目录不可读与空目录，并在重读失败时撤下旧项目', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.signatories.mockRejectedValue(new Error('无权限'))
  let denied = true
  mocks.load.mockImplementation(async ([key]: [string]) => {
    if (key === 'projects' && denied)
      throw new Error('项目目录无权限')
    return { projects: key === 'projects' ? [{ id: 'project-one', label: '真实项目', version: '1', sourceVersion: 'projects:1' }] : [], suppliers: [], contracts: [] }
  })
  const stub = defineComponent({ name: 'LedgerStub', props: ['workspace', 'projects', 'projectsReadable', 'verifyProjects'], template: '<div>台账已加载</div>' })
  const wrapper = mount(CentralInvoiceEntry, { props: { mode: 'ledger' }, global: { stubs: { CentralInvoiceLedgerScreen: stub } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('台账已加载'))
  expect(wrapper.findComponent(stub).props('projectsReadable')).toBe(false)
  expect(wrapper.findComponent(stub).props('projects')).toEqual([])
  expect(wrapper.text()).toContain('项目')
  denied = false
  await wrapper.findComponent(stub).props('verifyProjects')()
  await nextTick()
  expect(wrapper.findComponent(stub).props('projectsReadable')).toBe(true)
  expect(wrapper.findComponent(stub).props('projects')).toMatchObject([{ id: 'project-one', label: '真实项目' }])
  denied = true
  await expect(wrapper.findComponent(stub).props('verifyProjects')()).rejects.toThrow('项目目录无权限')
  await nextTick()
  expect(wrapper.findComponent(stub).props('projectsReadable')).toBe(false)
  expect(wrapper.findComponent(stub).props('projects')).toEqual([])
  wrapper.unmount()
})

it('项目目录重读期间身份变化时，迟到结果不能恢复旧台账', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.signatories.mockRejectedValue(new Error('无权限'))
  mocks.load.mockResolvedValue({ projects: [], suppliers: [], contracts: [] })
  const stub = defineComponent({ name: 'LedgerStub', props: ['workspace', 'projects', 'projectsReadable', 'verifyProjects'], template: '<div>台账已加载</div>' })
  const wrapper = mount(CentralInvoiceEntry, { props: { mode: 'ledger' }, global: { stubs: { CentralInvoiceLedgerScreen: stub } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('台账已加载'))
  let release!: (value: { projects: unknown[], suppliers: unknown[], contracts: unknown[] }) => void
  mocks.load.mockImplementationOnce(() => new Promise<{ projects: unknown[], suppliers: unknown[], contracts: unknown[] }>((resolve) => {
    release = resolve
  }))
  const pending = wrapper.findComponent(stub).props('verifyProjects')()
  mocks.authority?.({ message: '身份已变化' })
  await nextTick()
  release({ projects: [{ id: 'project-one', label: '旧项目', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] })
  await expect(pending).rejects.toThrow('项目目录来源已变化')
  expect(wrapper.text()).toContain('身份已变化')
  expect(wrapper.text()).not.toContain('台账已加载')
  expect(wrapper.text()).not.toContain('旧项目')
  wrapper.unmount()
})

it('工作台项目目录不可用时可点击重试，失败保留缺口，成功后传递稳定项目身份', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.signatories.mockRejectedValue(new Error('无权限'))
  let available = false
  mocks.load.mockImplementation(async ([key]: [string]) => {
    if (key === 'projects' && !available)
      throw new Error('项目目录无权限')
    return { projects: key === 'projects' ? [{ id: 'project-two', label: '同名项目', version: '1', sourceVersion: 'projects:1' }] : [], suppliers: [], contracts: [] }
  })
  const stub = defineComponent({ name: 'WorkspaceStub', props: ['workspace', 'projects'], template: '<div>工作台已加载</div>' })
  const wrapper = mount(CentralInvoiceEntry, { props: { mode: 'workspace' }, global: { stubs: { CentralInvoiceWorkspaceScreen: stub } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('工作台已加载'))
  expect(wrapper.findComponent(stub).props('projects')).toEqual([])
  const retry = () => wrapper.findAll('button').find(button => button.text() === '重新读取项目目录')!
  expect(retry().exists()).toBe(true)
  await retry().trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe('项目目录无权限')
  expect(wrapper.findComponent(stub).props('projects')).toEqual([])
  available = true
  await retry().trigger('click')
  await flushPromises()
  expect(wrapper.findComponent(stub).props('projects')).toMatchObject([{ id: 'project-two', label: '同名项目' }])
  expect(wrapper.findAll('button').some(button => button.text() === '重新读取项目目录')).toBe(false)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  wrapper.unmount()
})

it('工作台重读项目目录时身份失效，迟到成功不能恢复项目或工作台', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.signatories.mockRejectedValue(new Error('无权限'))
  mocks.load.mockImplementation(async ([key]: [string]) => {
    if (key === 'projects')
      throw new Error('项目目录无权限')
    return { projects: [], suppliers: [], contracts: [] }
  })
  const stub = defineComponent({ name: 'WorkspaceStub', props: ['workspace', 'projects'], template: '<div>工作台已加载</div>' })
  const wrapper = mount(CentralInvoiceEntry, { props: { mode: 'workspace' }, global: { stubs: { CentralInvoiceWorkspaceScreen: stub } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('工作台已加载'))
  let release!: (value: { projects: unknown[], suppliers: unknown[], contracts: unknown[] }) => void
  mocks.load.mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const retry = wrapper.findAll('button').find(button => button.text() === '重新读取项目目录')!
  await retry.trigger('click')
  expect(retry.attributes('disabled')).toBeDefined()
  mocks.authority?.({ message: '身份已变化' })
  await nextTick()
  release({ projects: [{ id: 'old-project', label: '过期项目' }], suppliers: [], contracts: [] })
  await flushPromises()
  expect(wrapper.text()).toContain('身份已变化')
  expect(wrapper.text()).not.toContain('工作台已加载')
  expect(wrapper.text()).not.toContain('过期项目')
  wrapper.unmount()
})

it('工作台重读得到真实空项目目录时撤下不可用提示，但不生成项目', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.signatories.mockRejectedValue(new Error('无权限'))
  let failProjects = true
  mocks.load.mockImplementation(async ([key]: [string]) => {
    if (key === 'projects' && failProjects)
      throw new Error('项目目录无权限')
    return { projects: [], suppliers: [], contracts: [] }
  })
  const stub = defineComponent({ name: 'WorkspaceStub', props: ['workspace', 'projects'], template: '<div>工作台已加载</div>' })
  const wrapper = mount(CentralInvoiceEntry, { props: { mode: 'workspace' }, global: { stubs: { CentralInvoiceWorkspaceScreen: stub } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('工作台已加载'))
  expect(wrapper.get('[role="status"]').text()).toContain('项目')
  failProjects = false
  const retry = wrapper.findAll('button').find(button => button.text() === '重新读取项目目录')!
  await retry.trigger('click')
  await flushPromises()
  expect(wrapper.findComponent(stub).props('projects')).toEqual([])
  expect(wrapper.findAll('button').some(button => button.text() === '重新读取项目目录')).toBe(false)
  expect(wrapper.get('[role="status"]').text()).not.toContain('项目')
  wrapper.unmount()
})

it.each(['身份撤销', '组件卸载', '读取成功', '读取失败'] as const)('项目重读遇到%s会移除焦点监听', async (change) => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.signatories.mockRejectedValue(new Error('无权限'))
  mocks.load.mockImplementation(async ([key]: [string]) => {
    if (key === 'projects')
      throw new Error('项目目录无权限')
    return { projects: [], suppliers: [], contracts: [] }
  })
  const stub = defineComponent({ name: 'WorkspaceStub', props: ['workspace', 'projects'], template: '<div>工作台已加载</div>' })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const wrapper = mount(CentralInvoiceEntry, { attachTo: container, props: { mode: 'workspace' }, global: { stubs: { CentralInvoiceWorkspaceScreen: stub } } })
  const add = vi.spyOn(document, 'addEventListener')
  const remove = vi.spyOn(document, 'removeEventListener')
  let release!: (value: { projects: unknown[], suppliers: unknown[], contracts: unknown[] }) => void
  let rejectRead!: (error: Error) => void
  try {
    await vi.waitFor(() => expect(wrapper.text()).toContain('工作台已加载'))
    mocks.load.mockImplementationOnce(() => new Promise((resolve, reject) => {
      release = resolve
      rejectRead = reject
    }))
    const retry = wrapper.findAll('button').find(button => button.text() === '重新读取项目目录')!
    ;(retry.element as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(retry.element)
    await retry.trigger('click')
    const focusListener = add.mock.calls.find(([name]) => name === 'focusin')?.[1]
    const pointerListener = add.mock.calls.find(([name]) => name === 'pointerdown')?.[1]
    expect(focusListener).toBeTypeOf('function')
    expect(pointerListener).toBeTypeOf('function')
    if (change === '身份撤销')
      mocks.authority?.({ message: '身份已变化' })
    else if (change === '组件卸载')
      wrapper.unmount()
    else if (change === '读取成功')
      release({ projects: [], suppliers: [], contracts: [] })
    else rejectRead(new Error('项目目录仍不可用'))
    if (change === '读取成功' || change === '读取失败')
      await flushPromises()
    expect(remove).toHaveBeenCalledWith('focusin', focusListener)
    expect(remove).toHaveBeenCalledWith('pointerdown', pointerListener)
    release({ projects: [{ id: 'old-project', label: '过期项目' }], suppliers: [], contracts: [] })
    await flushPromises()
    expect(container.textContent).not.toContain('过期项目')
  }
  finally {
    release?.({ projects: [], suppliers: [], contracts: [] })
    if (change !== '组件卸载')
      wrapper.unmount()
    add.mockRestore()
    remove.mockRestore()
    container.remove()
  }
})
