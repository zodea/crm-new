import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'

const mocks = vi.hoisted(() => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  return { ready, release: () => release(), loading: vi.fn(), inspect: vi.fn(), invalidate: (_problem: { message: string }) => {} }
})
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (invalidate: typeof mocks.invalidate) => {
    mocks.invalidate = invalidate
  },
}))
vi.mock('~/lib/db/native-snapshot', async () => {
  mocks.loading()
  await mocks.ready
  return { inspectNativeMigrationSnapshot: mocks.inspect }
})

it('sQLite 模块载入期间来源失效后不启动旧快照校验', async () => {
  const source = vi.fn()
  const publish = vi.fn()
  const session = { state: vi.fn(async () => []), pending: () => null, publish }
  render(InvoiceMigrationPanel, { props: { session: session as never, previewClient: { source } as never, catalogClient: {} as never } })
  const input = screen.getByLabelText('选择完整 SQLite 快照') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  const file = new File(['synthetic'], 'synthetic.sqlite')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
  await fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(mocks.loading).toHaveBeenCalledOnce())
  expect(mocks.inspect).not.toHaveBeenCalled()
  mocks.invalidate({ message: '合成来源已失效' })
  mocks.release()
  await flushPromises()
  expect(mocks.inspect).not.toHaveBeenCalled()
  expect(source).not.toHaveBeenCalled()
  expect(publish).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('合成来源已失效')
})
