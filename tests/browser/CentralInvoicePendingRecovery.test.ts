import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

it('重进工作台可用键盘依次核对不在列表中的原命令', async () => {
  const commands = [{ targetId: 'invoice-deleted', action: 'discard' }, { targetId: 'invoice-restored', action: 'restore' }]
  const recovered: string[] = []
  const workspace = {
    records: shallowRef([]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    sourceVersion: shallowRef('invoices:1'),
    load: async () => {},
    pending: () => null,
    pendingAll: () => [...commands],
    recover: async (targetId: string) => {
      recovered.push(targetId)
      commands.shift()
      return { outcome: 'applied', read: { record: { id: targetId } } }
    },
  }
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: workspace as never, projects: [], suppliers: [], signatories: [] }) }), { global: { stubs: { NuxtLink: true } } })
  const button = page.getByRole('button', { name: '核对上次提交' })
  await expect.element(button).toBeVisible()
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await vi.waitFor(() => expect(recovered).toEqual(['invoice-deleted']))
  await button.click()
  await vi.waitFor(() => expect(recovered).toEqual(['invoice-deleted', 'invoice-restored']))
  await expect.element(button).not.toBeInTheDocument()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
