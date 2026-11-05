import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'
import Candidate from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'
import { syntheticOriginalFixture } from '../helpers/central-invoice-original-fixture'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

async function sourcePane() {
  if (window.innerWidth < 960)
    await page.getByRole('tab', { name: '原件' }).click()
}

it('预选后真实校验合成原件，键盘使用原图并在失权时撤下', async () => {
  const fixture = await syntheticOriginalFixture()
  await render(defineComponent({ setup: () => () => h(Candidate, { workspace: fixture.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: fixture.record.id }) }), { global: { stubs: { NuxtLink: true } } })
  await sourcePane()
  await expect.element(page.getByRole('img', { name: '合成.png' })).toBeVisible()
  expect(fixture.events).toEqual(['authorize', 'detail', 'binary', 'detail', 'authorize', 'authorize'])
  const zoom = page.getByRole('button', { name: '放大原图' })
  zoom.element().focus()
  await expect.element(zoom).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
  fixture.revoke()
  await expect(fixture.real.load()).rejects.toThrow('权限')
  await expect.element(page.getByText('发票来源尚不可用。')).toBeVisible()
  await expect.poll(() => {
    const image = document.querySelector('img[alt="合成.png"]')
    return !image || image.getClientRects().length === 0
  }).toBe(true)
})

it('同 ID、版本切换来源时旧合成图片迟到不能覆盖新图', async () => {
  const first = await syntheticOriginalFixture('delay', '旧合成.png')
  const second = await syntheticOriginalFixture('good', '新合成.png')
  const source = shallowRef(first.workspace)
  await render(defineComponent({ setup: () => () => h(Candidate, { workspace: source.value, projects: [], suppliers: [], signatories: [], initialSelectedId: first.record.id }) }), { global: { stubs: { NuxtLink: true } } })
  await sourcePane()
  await expect.poll(() => first.events.includes('binary')).toBe(true)
  source.value = second.workspace
  await expect.element(page.getByRole('img', { name: '新合成.png' })).toBeVisible()
  first.release()
  await expect.poll(() => first.events.filter(value => value === 'authorize').length).toBeGreaterThanOrEqual(3)
  await expect.element(page.getByRole('img', { name: '新合成.png' })).toBeVisible()
  expect(document.querySelector('img[alt="旧合成.png"]')).toBeNull()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it('合成原件摘要不一致时显示缺口，重试通过核验后才显示', async () => {
  const fixture = await syntheticOriginalFixture('digest')
  await render(defineComponent({ setup: () => () => h(Candidate, { workspace: fixture.workspace, projects: [], suppliers: [], signatories: [], initialSelectedId: fixture.record.id }) }), { global: { stubs: { NuxtLink: true } } })
  await sourcePane()
  await expect.element(page.getByText('原件暂时无法读取，请重试。')).toBeVisible()
  expect(document.querySelector('img[alt="合成.png"]')).toBeNull()
  fixture.setMode('good')
  const retry = page.getByRole('button', { name: '重试读取原件' })
  retry.element().focus()
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('img', { name: '合成.png' })).toBeVisible()
})
