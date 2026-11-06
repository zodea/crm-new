import type { ProductionBackupAction, ProductionBackupStatus } from '~/lib/production/backup-contract'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'
import ProductionBackupDialog from '~/components/production/ProductionBackupDialog.vue'

it('备份弹窗提示清理暂停与空间管理，键盘操作和焦点在各视口保持可用', async ({ task }) => {
  const match = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(match).not.toBeNull()
  expect(window.innerWidth).toBe(Number(match![1]))
  const status: ProductionBackupStatus = { workspaceId: 'synthetic-workspace', ownerId: 'synthetic-owner', configured: true, protection: 'never', intervalHours: 12, latest: null, offline: null, baseline: null, running: false, recent: [], releaseState: 'awaiting-final-acceptance' }
  const actions: ProductionBackupAction[] = []
  const Root = defineComponent({
    setup() {
      const open = shallowRef(false)
      const trigger = shallowRef<HTMLButtonElement | null>(null)
      return () => h('div', [
        h('button', { ref: trigger, type: 'button', onClick: () => { open.value = true } }, '备份与恢复'),
        h(ProductionBackupDialog, { 'open': open.value, 'onUpdate:open': (value: boolean) => { open.value = value }, 'status': status, 'busy': false, 'problem': '', 'pending': null, 'result': null, 'onAction': (action: ProductionBackupAction) => actions.push(action), 'onReturnFocus': () => trigger.value?.focus() }),
      ])
    },
  })
  const view = await render(Root)
  const trigger = page.getByRole('button', { name: '备份与恢复' })
  ;(trigger.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  const dialog = page.getByRole('dialog', { name: '备份与恢复' })
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog).toHaveTextContent('自动清理已暂停')
  await expect.element(dialog).toHaveTextContent('检查备份位置的可用空间')
  await expect.element(dialog).toHaveTextContent('此前清理中断的副本可能不完整')
  const node = dialog.element() as HTMLElement
  expect(node.scrollWidth).toBeLessThanOrEqual(node.clientWidth + 1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  expect(node.textContent).not.toMatch(/[A-Z]:[\\/]/)
  const backup = page.getByRole('button', { name: '立即备份' })
  ;(backup.element() as HTMLElement).focus()
  await expect.element(backup).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(actions).toEqual(['backup'])
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  view.unmount()
})

it('状态未读出且原操作待核对时仍提示清理暂停', async ({ task }) => {
  const match = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(match).not.toBeNull()
  expect(window.innerWidth).toBe(Number(match![1]))
  const view = await render(ProductionBackupDialog, {
    props: { open: true, status: null, busy: false, problem: '', pending: { action: 'backup', commandId: 'synthetic-pending', sourceBackupId: null }, result: null },
  })
  const dialog = page.getByRole('dialog', { name: '备份与恢复' })
  await expect.element(dialog).toHaveTextContent('自动清理已暂停')
  await expect.element(dialog).toHaveTextContent('检查备份位置的可用空间')
  await expect.element(page.getByRole('button', { name: '核对原操作' })).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  view.unmount()
})
