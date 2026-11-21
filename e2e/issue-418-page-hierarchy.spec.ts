import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installFinanceListFixtures } from './helpers/finance-list-fixture'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })

async function showDemoData(page: Page) {
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
}

test.describe('Issue #418：页面层次与红圈结构对齐', () => {
  test.beforeEach(async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': `layout-418-${randomUUID()}` })
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  })

  for (const input of [
    { project: PROJECT_INPUTS[0], count: 12 },
    { project: PROJECT_INPUTS[1], count: 24 },
  ]) {
    test(`200% 等效视口中受控项目列表汇总随工作区吸底：${input.count}条`, async ({ page }) => {
      await showDemoData(page)
      await page.setViewportSize({ width: 720, height: 500 })
      const sessionId = `layout-long-list-${randomUUID()}`
      await installProjectCentralFixture(page, input.project, { sessionId })
      const session = await (await page.request.get('/api/read/business-session')).json()
      for (let index = 1; index < input.count; index++) {
        const created = await page.request.post('/api/commands/projects', { data: { ...session, commandId: randomUUID(), requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: `${input.project.name}-${index}`, code: `${input.project.code}-${index}`, status: input.project.status, manager: input.project.manager }, attachments: {} } })
        expect(created.ok(), await created.text()).toBe(true)
      }
      await page.goto('/project')
      await expect(page.getByRole('link', { name: `${input.project.name}-${input.count - 1}`, exact: true })).toBeVisible()
      const shell = page.locator('[data-list-shell]')
      const workspace = page.locator('[data-shell-workspace]')
      const summary = shell.getByRole('status', { name: '列表汇总' })
      await expect(summary).toBeVisible()
      const initial = await Promise.all([shell.boundingBox(), workspace.boundingBox(), summary.boundingBox()])
      expect(initial[0]!.height).toBeGreaterThan(initial[1]!.height)
      expect(initial[2]!.y + initial[2]!.height).toBeLessThanOrEqual(initial[1]!.y + initial[1]!.height + 1)
      await workspace.evaluate(element => element.scrollTo({ top: 100 }))
      await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect(summary).toBeInViewport()
      await expectNoPageOverflow(page, '长列表工作区滚动')
    })
  }

  for (const width of [390, 768, 1024, 1280, 1440]) {
    test(`${width}px 详情资料分区、业务页签与金额跳转`, async ({ page }) => {
      await showDemoData(page)
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.goto('/base/supplier/sup_demo_004?origin=demo')
      const nav = page.getByRole('navigation', { name: '分供方业务事实' })
      await expect(nav.getByRole('tab', { name: '详细资料', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('region', { name: '基础信息', exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: '联系人信息', exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: '开票信息', exact: true })).toBeVisible()
      await expectNoPageOverflow(page, `分供方详细资料 ${width}`)

      const columns = await page.locator('[data-ui="entity-detail-body"]').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      expect(columns).toBeGreaterThanOrEqual(1)
      expect(columns).toBeLessThanOrEqual(2)
      if (width === 390)
        expect(columns).toBe(1)
      if (width >= 1280)
        expect(columns).toBe(2)
      const body = page.locator('[data-ui="entity-detail-body"]')
      const geometry = await body.evaluate(element => ({ bounds: element.getBoundingClientRect().toJSON(), children: [...element.children].map(child => child.getBoundingClientRect().toJSON()) }))
      for (const child of geometry.children) {
        expect(child.left).toBeGreaterThanOrEqual(geometry.bounds.left - 1)
        expect(child.right).toBeLessThanOrEqual(geometry.bounds.right + 1)
      }

      const contracts = nav.getByRole('tab', { name: /支出合同/ })
      await contracts.click()
      await expect(page.getByRole('region', { name: '基础信息', exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: '五金机电采购合同' })).toBeVisible()
      await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('contracts')
      await page.reload()
      await expect(contracts).toHaveAttribute('aria-selected', 'true')
      await contracts.focus()
      await page.keyboard.press('ArrowRight')
      await expect(nav.getByRole('tab', { name: /支出结算/ })).toHaveAttribute('aria-selected', 'true')

      await page.getByRole('button', { name: '查看累计付款金额明细' }).click()
      const payments = nav.getByRole('tab', { name: /付款管理/ })
      await expect(payments).toHaveAttribute('aria-selected', 'true')
      await expect(payments).toBeFocused()
      await expect(payments).toBeInViewport()
      await expect(page.getByRole('link', { name: '五金机电采购首期请款' })).toBeVisible()
      await expectNoPageOverflow(page, `分供方业务页签 ${width}`)
      const workspace = page.locator('[data-shell-workspace]')
      expect(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    })

    for (const path of ['/finance/current', '/material/arrival', '/contract/construction', '/base/supplier', '/project', '/contract/material']) {
      test(`${width}px 列表连续工作面与主操作：${path}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
        if (path === '/finance/current')
          await installFinanceListFixtures(page)
        else
          await showDemoData(page)
        await page.goto(path)
        const shell = page.locator('[data-list-shell]')
        await expect(shell).toBeVisible({ timeout: 20_000 })
        const toolbar = shell.locator('[data-list-shell-toolbar]')
        await expect(toolbar).toBeVisible()
        const table = shell.locator('[data-list-shell-table]')
        await expect(table.locator('.vxe-table')).toBeVisible({ timeout: 20_000 })
        await expectNoPageOverflow(page, `${path} ${width}`)
        expect(await shell.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        const bounds = await Promise.all([toolbar.boundingBox(), table.boundingBox()])
        expect(bounds[0]!.y).toBeLessThan(bounds[1]!.y)
        const create = shell.getByRole('button', { name: /新建|新增/ }).or(shell.getByRole('link', { name: /新建|新增/ }))
        await expect(create).toBeVisible()
        await create.focus()
        await expect(create).toBeInViewport()
      })
    }

    for (const input of [
      { path: '/finance/current/new', attachment: '凭证与备注' },
      { path: '/material/arrival/new', attachment: '送货单附件' },
    ]) {
      test(`${width}px 整页表单分区、两列上限与吸底操作：${input.path}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
        if (input.path === '/finance/current/new')
          await installFinanceListFixtures(page, true)
        else
          await showDemoData(page)
        await page.goto(input.path)
        const shell = page.locator('[data-ui="entity-form-shell"]')
        await expect(shell).toBeVisible({ timeout: 20_000 })
        const footer = page.getByRole('group', { name: '表单操作' })
        await expect(footer).toBeVisible()
        const fields = shell.locator('.form-fields-grid').first()
        await expect(fields).toBeVisible()
        const count = await fields.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
        expect(count).toBeLessThanOrEqual(2)
        if (width === 390)
          expect(count).toBe(1)
        await expectNoPageOverflow(page, `${input.path} ${width}`)
        const save = footer.getByRole('button', { name: '保存', exact: true })
        await expect(save).toBeEnabled({ timeout: 20_000 })
        await save.focus()
        await expect(save).toBeInViewport()
        await expect(save).toBeFocused()
        const nav = shell.getByRole('navigation', { name: '表单分区' })
        if (width >= 1280) {
          await expect(nav).toBeVisible()
          await nav.getByRole('link', { name: input.attachment, exact: true }).click()
          expect(new URL(page.url()).hash).toBe('')
        }
        else {
          await expect(nav).toBeHidden()
        }
      })
    }
  }
})
