import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import CentralInvoiceManualEntry from '~/components/invoice/CentralInvoiceManualEntry.vue'

const state = vi.hoisted(() => ({ authority: null as null | ((problem: { message: string }) => void) }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => false }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {}, onBeforeRouteUpdate: () => {} }))
vi.mock('~/lib/read-model/authority', () => ({
  bindReadAuthority: (callback: typeof state.authority) => { state.authority = callback },
}))
vi.mock('~/lib/invoice/central-bootstrap', () => ({
  parseInvoiceSession: (value: unknown) => value,
  createInvoiceWorkspaceFromSession: async () => ({ readState: shallowRef('ready'), pendingAll: () => [], load: async () => {} }),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  state.authority = null
})

it('失权隐藏票面，同身份重新读取保留输入，换身份后不暴露原输入', async () => {
  let actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/' } }))
  vi.stubGlobal('$fetch', async () => actor)
  render(CentralInvoiceManualEntry, { global: { stubs: { NuxtLink: true } } })
  const field = await screen.findByLabelText('发票号码') as HTMLInputElement
  await fireEvent.update(field, 'PRIVATE-INPUT')
  state.authority?.({ message: '当前权限不可用。' })
  await waitFor(() => expect(field.closest('section')?.style.display).toBe('none'))
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await waitFor(() => expect(field.closest('section')?.style.display).not.toBe('none'))
  expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('PRIVATE-INPUT')
  state.authority?.({ message: '当前身份已变化。' })
  await waitFor(() => expect(field.closest('section')?.style.display).toBe('none'))
  actor = { ...actor, actorId: 'actor-two' }
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await waitFor(() => expect(screen.getByLabelText('发票号码')).not.toBe(field))
  expect((screen.getByLabelText('发票号码') as HTMLInputElement).value).toBe('')
})
