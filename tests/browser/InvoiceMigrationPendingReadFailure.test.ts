import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import InvoiceMigrationPanel from '~/components/migration/InvoiceMigrationPanel.vue'

const authority = vi.hoisted(() => ({ changed: (_problem: { message: string }) => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true }) }))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: (changed: typeof authority.changed) => {
  authority.changed = changed
} }))

it('批次读取挂起时立即显示原编号，失权时撤下且不被迟到结果覆盖', async () => {
  let release!: (value: never[]) => void
  const session = { pendingAll: () => [{ commandId: 'pending-command', targetId: null }], state: () => new Promise<never[]>((resolve) => {
    release = resolve
  }) }
  await render(defineComponent({ setup: () => () => h(InvoiceMigrationPanel, { session: session as never, previewClient: {} as never, catalogClient: {} as never }) }))
  await expect.element(page.getByText('原提交 pending-command 尚未核对。')).toBeVisible()
  await expect.element(page.getByLabelText('选择完整 SQLite 快照')).toBeDisabled()
  authority.changed({ message: '当前身份无读取权限。' })
  await expect.element(page.getByText('当前身份无读取权限。')).toBeVisible()
  release([])
  await expect.element(page.getByText('原提交 pending-command 尚未核对。')).not.toBeInTheDocument()
  await expect.element(page.getByText('当前身份无读取权限。')).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
