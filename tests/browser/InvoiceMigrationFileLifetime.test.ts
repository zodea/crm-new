import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), invalidate: (_problem: { message: string }) => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (invalidate: typeof mocks.invalidate) => {
    mocks.invalidate = invalidate
  },
}))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: mocks.inspect }))

const inspected = { sha256: 'a'.repeat(64), schemaVersion: 60 }
const sourcePreview = { sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [], references: [], orphanLogCount: 0 }
function renderPanel(source: ReturnType<typeof vi.fn>, mappings: ReturnType<typeof vi.fn>) {
  const session = { state: async () => [], pending: () => null, publish: vi.fn() }
  const catalog = { load: async () => ({ projects: [], suppliers: [], contracts: [] }) }
  return render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(InvoiceMigrationPanel, { session, previewClient: { source, mappings }, catalogClient: catalog } as never)) }))
}
function selectFile(input: HTMLInputElement, file: File) {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

it('合成快照正常预检，文件入口与核对按钮支持键盘', async ({ task }) => {
  const width = Number(/^chromium-(390|1280)$/.exec(task.file.projectName ?? '')?.[1])
  expect(window.innerWidth).toBe(width)
  mocks.inspect.mockReset().mockResolvedValue(inspected)
  const source = vi.fn(async () => sourcePreview)
  const mappings = vi.fn(async () => ({ sourceSha256: 'a'.repeat(64), invoiceCount: 0, orphanLogCount: 0, missingAllocationIds: [] }))
  await renderPanel(source, mappings)
  const input = page.getByLabelText('选择完整 SQLite 快照')
  await expect.element(input).toBeEnabled()
  ;(input.element() as HTMLElement).focus()
  await expect.element(input).toHaveFocus()
  selectFile(input.element() as HTMLInputElement, new File(['synthetic'], 'synthetic.sqlite'))
  await expect.element(page.getByText(/0 条发票/)).toBeVisible()
  const check = page.getByRole('button', { name: '核对映射与历史付款' })
  await expect.element(check).toBeEnabled()
  ;(check.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('映射预检通过；提交时会再次核对。')).toBeVisible()
  expect(source).toHaveBeenCalledOnce()
  expect(mappings).toHaveBeenCalledOnce()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})

it('读取中的合成快照在来源失效后不再开始校验与预检', async ({ task }) => {
  const width = Number(/^chromium-(390|1280)$/.exec(task.file.projectName ?? '')?.[1])
  expect(window.innerWidth).toBe(width)
  mocks.inspect.mockReset().mockResolvedValue(inspected)
  const source = vi.fn()
  const mappings = vi.fn()
  await renderPanel(source, mappings)
  const input = page.getByLabelText('选择完整 SQLite 快照')
  await expect.element(input).toBeEnabled()
  let release!: (bytes: ArrayBuffer) => void
  const bytes = new Promise<ArrayBuffer>((resolve) => {
    release = resolve
  })
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: () => bytes })
  selectFile(input.element() as HTMLInputElement, file)
  await expect.element(input).toBeDisabled()
  mocks.invalidate({ message: '合成来源已失效' })
  release(new Uint8Array([1]).buffer)
  await expect.element(page.getByRole('alert')).toHaveTextContent('合成来源已失效')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(mocks.inspect).not.toHaveBeenCalled()
  expect(source).not.toHaveBeenCalled()
  expect(mappings).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
