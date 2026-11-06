import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  invalidate: (_problem: { message: string }) => {},
}))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (invalidate: typeof mocks.invalidate) => {
    mocks.invalidate = invalidate
  },
}))
vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: mocks.inspect }))

const inspected = { sha256: 'a'.repeat(64), schemaVersion: 60 }
const sourcePreview = { sourceSha256: 'a'.repeat(64), schemaVersion: 60, invoices: [], references: [], orphanLogCount: 0 }
function createFixture() {
  const source = vi.fn(async () => sourcePreview)
  const publish = vi.fn()
  const session = { state: vi.fn(async () => []), pending: () => null, publish }
  const catalogClient = { load: vi.fn(async () => ({ projects: [], suppliers: [], contracts: [] })) }
  const view = render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: { source } as never, catalogClient } })
  return { view, source, publish }
}
async function choose(file: File) {
  const input = screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  await fireEvent.change(input, { target: { files: [file] } })
}

for (const reason of ['卸载', '来源失效'] as const) {
  it(`文件读取中${reason}后，不再启动 SQLite 校验或预检`, async () => {
    mocks.inspect.mockReset().mockResolvedValue(inspected)
    const fixture = createFixture()
    let release!: (bytes: ArrayBuffer) => void
    const bytes = new Promise<ArrayBuffer>((resolve) => {
      release = resolve
    })
    const file = new File(['synthetic'], 'synthetic.sqlite')
    Object.defineProperty(file, 'arrayBuffer', { value: () => bytes })
    await choose(file)
    expect(mocks.inspect).not.toHaveBeenCalled()
    if (reason === '卸载')
      fixture.view.unmount()
    else
      mocks.invalidate({ message: '合成来源已失效' })
    release(new Uint8Array([1]).buffer)
    await flushPromises()
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(fixture.source).not.toHaveBeenCalled()
    expect(fixture.publish).not.toHaveBeenCalled()
    if (reason === '来源失效')
      expect(screen.getByRole('alert').textContent).toContain('合成来源已失效')
  })
}

it('正常读取仍启动校验并展示预检结果', async () => {
  mocks.inspect.mockReset().mockResolvedValue(inspected)
  const fixture = createFixture()
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await choose(file)
  await screen.findByText(/0 条发票/)
  expect(mocks.inspect).toHaveBeenCalledOnce()
  expect(fixture.source).toHaveBeenCalledOnce()
  expect(fixture.publish).not.toHaveBeenCalled()
})

it('已开始的 SQLite 校验完成后若来源失效，不再继续预检', async () => {
  let release!: (value: typeof inspected) => void
  mocks.inspect.mockReset().mockImplementation(() => new Promise((resolve) => {
    release = resolve
  }))
  const fixture = createFixture()
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await choose(file)
  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledOnce())
  mocks.invalidate({ message: '合成来源已失效' })
  release(inspected)
  await flushPromises()
  expect(fixture.source).not.toHaveBeenCalled()
  expect(fixture.publish).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('合成来源已失效')
})

for (const kind of ['session', 'preview', 'catalog', 'buyers'] as const) {
  it(`文件读取期间同一轮替换 ${kind} 来源后不启动旧快照校验`, async () => {
    mocks.inspect.mockReset().mockResolvedValue(inspected)
    const oldSource = vi.fn()
    const newSource = vi.fn()
    const session = shallowRef({ state: vi.fn(async () => []), pending: () => null, publish: vi.fn() })
    const preview = shallowRef({ source: oldSource })
    const catalog = shallowRef({ load: vi.fn() })
    const buyers = shallowRef(async () => [])
    const Parent = defineComponent({
      setup: () => () => h(InvoiceMigrationPanel, { session: session.value as never, previewClient: preview.value as never, catalogClient: catalog.value as never, loadBuyers: buyers.value }),
    })
    render(Parent)
    let release!: (bytes: ArrayBuffer) => void
    const bytes = new Promise<ArrayBuffer>((resolve) => {
      release = resolve
    })
    const file = new File(['synthetic'], 'synthetic.sqlite')
    Object.defineProperty(file, 'arrayBuffer', { value: () => bytes })
    await choose(file)
    release(new Uint8Array([1]).buffer)
    if (kind === 'session')
      session.value = { state: vi.fn(async () => []), pending: () => null, publish: vi.fn() }
    else if (kind === 'preview')
      preview.value = { source: newSource }
    else if (kind === 'catalog')
      catalog.value = { load: vi.fn() }
    else
      buyers.value = async () => []
    await flushPromises()
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(oldSource).not.toHaveBeenCalled()
    expect(newSource).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('来源或可用目录已变化')
  })
}

it('fileReader 已启动后来源失效，迟到结果不再预检或发布', async () => {
  mocks.inspect.mockReset().mockResolvedValue(inspected)
  let releaseRead: (() => void) | undefined
  class ControlledReader {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result = 'data:application/octet-stream;base64,c3ludGhldGlj'
    readAsDataURL() { releaseRead = () => this.onload?.() }
  }
  vi.stubGlobal('FileReader', ControlledReader)
  try {
    const fixture = createFixture()
    const file = new File(['synthetic'], 'synthetic.sqlite')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    await choose(file)
    await waitFor(() => expect(releaseRead).toBeDefined())
    mocks.invalidate({ message: '合成来源已失效' })
    releaseRead!()
    await flushPromises()
    expect(mocks.inspect).toHaveBeenCalledOnce()
    expect(fixture.source).not.toHaveBeenCalled()
    expect(fixture.publish).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('合成来源已失效')
  }
  finally { vi.unstubAllGlobals() }
})

it('fileReader 先完成而同一轮替换来源时不发送旧快照预检', async () => {
  mocks.inspect.mockReset().mockResolvedValue(inspected)
  let releaseRead: (() => void) | undefined
  class ControlledReader {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result = 'data:application/octet-stream;base64,c3ludGhldGlj'
    readAsDataURL() { releaseRead = () => this.onload?.() }
  }
  vi.stubGlobal('FileReader', ControlledReader)
  try {
    const source = vi.fn(async () => sourcePreview)
    const preview = { source }
    const catalog = { load: vi.fn(async () => ({ projects: [], suppliers: [], contracts: [] })) }
    const session = shallowRef({ state: vi.fn(async () => []), pending: () => null, publish: vi.fn() })
    const Parent = defineComponent({
      setup: () => () => h(InvoiceMigrationPanel, { session: session.value as never, previewClient: preview as never, catalogClient: catalog }),
    })
    render(Parent)
    const file = new File(['synthetic'], 'synthetic.sqlite')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    await choose(file)
    await waitFor(() => expect(releaseRead).toBeDefined())
    releaseRead!()
    session.value = { state: vi.fn(async () => []), pending: () => null, publish: vi.fn() }
    await flushPromises()
    expect(source).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('来源或可用目录已变化')
  }
  finally { vi.unstubAllGlobals() }
})

it('来源在代次检查与下一阶段之间变化时不发送旧快照预检', async () => {
  mocks.inspect.mockReset().mockResolvedValue(inspected)
  const events: string[] = []
  let releaseRead: (() => void) | undefined
  class ControlledReader {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result = 'data:application/octet-stream;base64,c3ludGhldGlj'
    readAsDataURL() { releaseRead = () => this.onload?.() }
  }
  vi.stubGlobal('FileReader', ControlledReader)
  try {
    const source = vi.fn(async () => {
      events.push('旧预检发送')
      return sourcePreview
    })
    const catalog = { load: vi.fn(async () => ({ projects: [], suppliers: [], contracts: [] })) }
    const session = shallowRef({ state: vi.fn(async () => []), pending: () => null, publish: vi.fn() })
    const Parent = defineComponent({
      setup: () => () => h(InvoiceMigrationPanel, { session: session.value as never, previewClient: { source } as never, catalogClient: catalog }),
    })
    render(Parent)
    const file = new File(['synthetic'], 'synthetic.sqlite')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    await choose(file)
    await waitFor(() => expect(releaseRead).toBeDefined())
    releaseRead!()
    queueMicrotask(() => queueMicrotask(() => {
      events.push('父来源切换')
      session.value = { state: vi.fn(async () => []), pending: () => null, publish: vi.fn() }
    }))
    await flushPromises()
    expect(events).toContain('父来源切换')
    if (events.includes('旧预检发送'))
      expect(events.indexOf('旧预检发送')).toBeLessThan(events.indexOf('父来源切换'))
    expect(catalog.load).not.toHaveBeenCalled()
    expect(screen.queryByText(/0 条发票/)).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('来源或可用目录已变化')
  }
  finally { vi.unstubAllGlobals() }
})

it('已启动解析先完成而同轮替换来源时不继续预检', async () => {
  let release!: (value: typeof inspected) => void
  mocks.inspect.mockReset().mockImplementation(() => new Promise((resolve) => {
    release = resolve
  }))
  const source = vi.fn()
  const session = shallowRef({ state: vi.fn(async () => []), pending: () => null, publish: vi.fn() })
  const Parent = defineComponent({ setup: () => () => h(InvoiceMigrationPanel, { session: session.value as never, previewClient: { source } as never, catalogClient: {} as never }) })
  render(Parent)
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await choose(file)
  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledOnce())
  release(inspected)
  session.value = { state: vi.fn(async () => []), pending: () => null, publish: vi.fn() }
  await flushPromises()
  expect(source).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('来源或可用目录已变化')
})

it('已发送预检先返回而同轮替换来源时不回填或读取旧目录', async () => {
  mocks.inspect.mockReset().mockResolvedValue(inspected)
  let release!: (value: typeof sourcePreview) => void
  const source = vi.fn(() => new Promise<typeof sourcePreview>((resolve) => {
    release = resolve
  }))
  const catalog = { load: vi.fn(async () => ({ projects: [], suppliers: [], contracts: [] })) }
  const session = shallowRef({ state: vi.fn(async () => []), pending: () => null, publish: vi.fn() })
  const Parent = defineComponent({ setup: () => () => h(InvoiceMigrationPanel, { session: session.value as never, previewClient: { source } as never, catalogClient: catalog }) })
  render(Parent)
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await choose(file)
  await waitFor(() => expect(source).toHaveBeenCalledOnce())
  release(sourcePreview)
  session.value = { state: vi.fn(async () => []), pending: () => null, publish: vi.fn() }
  await flushPromises()
  expect(catalog.load).not.toHaveBeenCalled()
  expect(screen.queryByText(/0 条发票/)).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('来源或可用目录已变化')
})
