import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { shallowRef } from 'vue'
import CentralInvoiceEntry from '~/components/invoice/CentralInvoiceEntry.vue'

const mocks = vi.hoisted(() => ({
  workspace: {} as unknown,
  load: vi.fn(),
  authority: null as null | ((problem: { message: string }) => void),
}))
vi.mock('~/lib/invoice/central-bootstrap', () => ({
  parseInvoiceSession: (value: unknown) => value,
  createInvoiceWorkspaceFromSession: async () => mocks.workspace,
}))
vi.mock('~/lib/invoice/central-migration-catalog', () => ({ createInvoiceWorkspaceCatalogClient: () => ({ load: mocks.load }) }))
vi.mock('~/lib/our-signatory/http-repository', () => ({ createOurSignatoryRepository: () => ({ list: async () => {
  throw new Error('无权限')
} }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (callback: typeof mocks.authority) => {
  mocks.authority = callback
} }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.authority = null
})

it('工作台目录失败可键盘重读，恢复后项目选择和公司上传入口保持可用', async ({ task }) => {
  const viewport = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(viewport).not.toBeNull()
  expect(window.innerWidth).toBe(Number(viewport![1]))
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  mocks.workspace = {
    records: shallowRef([]),
    readState: shallowRef('ready'),
    loading: shallowRef(false),
    load: async () => {},
    pendingAll: () => [],
    pending: () => null,
  }
  let attempts = 0
  let release!: (value: { projects: unknown[], suppliers: unknown[], contracts: unknown[] }) => void
  let rejectRetry!: (error: Error) => void
  mocks.load.mockImplementation(async ([key]: [string]) => {
    if (key !== 'projects')
      return { projects: [], suppliers: [], contracts: [] }
    attempts++
    if (attempts === 1)
      throw new Error('合成项目目录暂不可用')
    if (attempts === 2 || attempts === 3) {
      return new Promise((_resolve, reject) => {
        rejectRetry = reject
      })
    }
    return new Promise((resolve) => {
      release = resolve
    })
  })
  await render(CentralInvoiceEntry, {
    props: { mode: 'workspace' },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
  const retry = page.getByRole('button', { name: '重新读取项目目录' })
  await expect.element(retry).toBeVisible()
  const kind = page.getByLabelText('上传归属')
  const upload = page.getByLabelText('上传发票')
  await expect.element(upload).toBeDisabled()
  await kind.selectOptions('company')
  await expect.element(upload).toBeEnabled()
  await kind.selectOptions('project')
  await expect.element(upload).toBeDisabled()
  ;(retry.element() as HTMLElement).focus()
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: '正在读取项目目录…' })).toBeDisabled()
  rejectRetry(new Error('合成项目目录暂不可用'))
  await expect.element(page.getByRole('alert')).toHaveTextContent('合成项目目录暂不可用')
  await expect.element(retry).toHaveFocus()
  await expect.element(upload).toBeDisabled()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: '正在读取项目目录…' })).toBeDisabled()
  ;(kind.element() as HTMLElement).focus()
  await expect.element(kind).toHaveFocus()
  rejectRetry(new Error('合成项目目录仍不可用'))
  await expect.element(page.getByRole('alert')).toHaveTextContent('合成项目目录仍不可用')
  await expect.element(kind).toHaveFocus()
  ;(retry.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: '正在读取项目目录…' })).toBeDisabled()
  expect(attempts).toBe(4)
  release({ projects: [{ id: 'project-one', label: '同名项目' }, { id: 'project-two', label: '同名项目' }], suppliers: [], contracts: [] })
  await expect.element(retry).not.toBeInTheDocument()
  await expect.element(kind).toHaveFocus()
  const project = page.getByLabelText('上传项目')
  await project.selectOptions('project-two')
  expect((project.element() as HTMLSelectElement).value).toBe('project-two')
  await expect.element(upload).toBeEnabled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
