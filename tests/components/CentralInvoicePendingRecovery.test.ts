import type { CentralInvoiceCommand } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import { createProductionInvoiceService } from '../../server/utils/production-invoice-service'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

for (const action of ['discard', 'restore'] as const) {
  it(`${action} 已写入但响应丢失后，重进工作台仍可按原编号核对`, async () => {
    const f = await createSubcontractFixture()
    try {
      f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'finance-invoice:read', 'finance-invoice:write'] })
      const service = createProductionInvoiceService(f.storage)
      const base = { workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'finance-invoice:write' as const }
      const fields = { invoiceNumber: `GUARD-${action}`, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
      const created = await service.execute({ ...base, action: 'manual', commandId: `recovery-create-${action}`, baseVersion: null, fields, items: [] }, f.session)
      if (action === 'restore')
        await service.execute({ ...base, action: 'discard', commandId: 'recovery-prepare-discard', invoiceId: created.invoiceId, baseVersion: created.version }, f.session)
      const saved = await service.get(created.invoiceId, f.session, true)
      const memory = new Map<string, string>()
      const storage = () => ({
        get length() { return memory.size },
        key: (index: number) => [...memory.keys()][index] ?? null,
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => { memory.set(key, value) },
        removeItem: (key: string) => { memory.delete(key) },
      })
      let lost = true
      const client = createCentralInvoiceHttp(async (url, options) => {
        if (url === '/api/commands/invoices') {
          const result = await service.execute(options!.body as CentralInvoiceCommand, f.session)
          if (lost) {
            lost = false
            throw new Error('合成响应丢失')
          }
          return result
        }
        if (url === '/api/commands/invoices/resolve')
          return service.resolve(String((options!.body as { commandId: string }).commandId), f.session)
        if (url === '/api/read/invoices')
          return service.listRead(options!.query!, f.session)
        if (url === `/api/read/invoices/${created.invoiceId}`)
          return service.getRead(created.invoiceId, f.session, options!.query?.deleted === 'true')
        throw new Error(`未预期的合成请求：${url}`)
      }, f.session())
      const workspace = () => createCentralInvoiceWorkspace({ identity: f.session(), client, context: async () => f.session(), recognizeLocal: async () => {
        throw new Error('未调用识别')
      }, storage, commandId: () => `recovery-command-${action}` })
      const beforeReload = workspace()
      await beforeReload.load()
      await expect(action === 'discard' ? beforeReload.discard(saved) : beforeReload.restore(saved)).rejects.toThrow('合成响应丢失')
      expect(beforeReload.pending(saved.id)?.commandId).toBe(`recovery-command-${action}`)
      const reentered = workspace()
      const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace: reentered, projects: [], suppliers: [], signatories: [] }, global: { stubs: { NuxtLink: true } } })
      await fireEvent.click(await screen.findByRole('button', { name: '核对上次提交' }, { timeout: 3000 }))
      await waitFor(() => expect(reentered.pending(saved.id)).toBeNull())
      await waitFor(() => expect(reentered.readState.value).toBe('ready'))
      expect(await service.execute({ ...base, action, invoiceId: saved.id, baseVersion: saved.version, commandId: `recovery-command-${action}` }, f.session)).toMatchObject({ invoiceId: saved.id, commandId: `recovery-command-${action}` })
      view.unmount()
    }
    finally { await f.storage.close() }
  }, 30_000)
}

it('损坏的恢复存储提示用户并阻止新的工作台操作', async () => {
  const workspace = { records: shallowRef([]), loading: shallowRef(false), readState: shallowRef('ready'), sourceVersion: shallowRef('invoices:1'), load: vi.fn(async () => {}), pendingAll: () => {
    throw new Error('无法可靠核对原提交编号，请保留输入并恢复浏览器存储。')
  } }
  const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [] }, global: { stubs: { NuxtLink: true } } })
  expect((await screen.findByRole('alert')).textContent).toContain('无法可靠核对原提交编号')
  expect((view.container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true)
  view.unmount()
})

it('更正原编号引导回更正单，不能调用普通发票恢复', async () => {
  const recover = vi.fn()
  const workspace = { records: shallowRef([]), loading: shallowRef(false), readState: shallowRef('ready'), sourceVersion: shallowRef('invoices:1'), load: vi.fn(async () => {}), pendingAll: () => [{ targetId: 'invoice-one', action: 'submit', scopeId: 'correction-one' }], recover }
  const view = render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [] }, global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
  const link = await screen.findByRole('link', { name: '前往更正单核对原提交' })
  expect(link.getAttribute('href')).toBe('/finance/invoice/correction/invoice-one')
  expect(screen.queryByRole('button', { name: '核对上次提交' })).toBeNull()
  expect(recover).not.toHaveBeenCalled()
  view.unmount()
})
