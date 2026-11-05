import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

it('各视口中断清单可键盘滚动，失权清除清单并以原编号核对', async () => {
  let pending: { targetId: null, action: string, commandId: string } | null = null
  const recovered: string[] = []
  const workspace = {
    records: shallowRef([]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    load: async () => {},
    pending: () => pending,
    pendingAll: () => pending ? [pending] : [],
    upload: vi.fn(async (file: File) => {
      if (file.name.startsWith('02')) {
        pending = { targetId: null, action: 'upload', commandId: 'original-upload' }
        throw new Error('合成响应丢失')
      }
      return { id: 'synthetic-one', version: '1', original: null }
    }),
    recognizeWithCandidate: vi.fn(async (record: object) => ({ record, candidate: {} })),
    recover: async () => {
      if (pending)
        recovered.push(pending.commandId)
      pending = null
      return { outcome: 'not-applied' }
    },
  }
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: workspace as never, projects: [{ id: 'project-one', label: '合成项目' }], suppliers: [], signatories: [] }) }), { global: { stubs: { NuxtLink: true } } })
  await page.getByLabelText('上传项目').selectOptions('project-one')
  const files = Array.from({ length: 16 }, (_, index) => new File(['%PDF-1.4'], `${String(index + 1).padStart(2, '0')}-${'合成发票'.repeat(16)}.pdf`, { type: 'application/pdf' }))
  await page.getByLabelText('上传发票').upload(files)
  const result = page.getByRole('region', { name: '本次上传结果' })
  await expect.element(result).toBeVisible()
  await vi.waitFor(() => expect(workspace.upload).toHaveBeenCalledTimes(2))
  expect(result.element().textContent).toContain('识别已回读')
  expect(result.element().textContent).toContain('结果未能确认')
  expect(result.element().textContent).toContain('未处理')
  const area = result.element() as HTMLElement
  expect(area.scrollHeight).toBeGreaterThan(area.clientHeight)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  area.focus()
  await expect.element(result).toHaveFocus()
  await userEvent.keyboard('{End}')
  await vi.waitFor(() => expect(area.scrollTop).toBeGreaterThan(0))
  workspace.readState.value = 'unavailable'
  await nextTick()
  await expect.element(result).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: '重新读取' })).toHaveFocus()
  workspace.readState.value = 'ready'
  await nextTick()
  await expect.element(result).not.toBeInTheDocument()
  const retry = page.getByRole('button', { name: '核对上次提交' })
  retry.element().focus()
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await vi.waitFor(() => expect(recovered).toEqual(['original-upload']))
  expect(workspace.upload).toHaveBeenCalledTimes(2)
})
