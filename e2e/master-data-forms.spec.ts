import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

const FORM_ROUTES = [
  ['/base/supplier/form', '新建 · 分供方'],
  ['/base/customer/form', '新建 · 客户'],
  ['/base/crew/form', '新建 · 班组'],
  ['/base/worker/form', '新建 · 工人'],
  ['/project/form', '新建 · 项目'],
  ['/project/target-cost/form?origin=real', '新建 · 目标成本'],
] as const
const FORM_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
] as const

test.describe('F1 基础主数据整页表单', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `master-form-${randomUUID()}` })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  })
  for (const viewport of FORM_VIEWPORTS) {
    for (const [path, title] of FORM_ROUTES) {
      test(`${viewport.width}px 具名路由完整五动作与页面边界：${title}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto(path)
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 20_000 })
        const footer = page.getByRole('group', { name: '表单操作' })
        const actionNames = ['取消', '保存草稿', '保存', '保存并新建', '保存并提交']
        await expect(footer.getByRole('button')).toHaveCount(actionNames.length)
        for (const name of actionNames)
          await expect(footer.getByRole('button', { name, exact: true })).toBeVisible()
        await expectNoPageOverflow(page, path)
      })
    }
  }
  test('切换页签保留未保存字段，不弹放弃确认', async ({ page }) => {
    await page.goto('/base/customer/form')
    await page.getByLabel('客户名称 *').fill('未保存的页签草稿')
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill('班组管理')
    await sidebar.getByRole('link', { name: '班组管理', exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/base/crew')
    await expect(page.getByRole('dialog', { name: '放弃修改' })).toHaveCount(0)
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '新建 · 客户', exact: true }).click()
    await expect(page.getByLabel('客户名称 *')).toHaveValue('未保存的页签草稿')
  })

  // 正式存储的删除、恢复及原件重启正向覆盖在 production-customer-storage.spec.ts。
  // 本套开发实例通过详情显式编辑，不要求旧列表删除按钮或演示写入。
  for (const input of [
    { name: '基础表单合成甲方甲', alias: '表单别名甲', taxNo: 'E2E-TAX-A', contact: '合成联系人甲', phone: '13800000011' },
    { name: '基础表单合成甲方乙', alias: '表单别名乙', taxNo: 'E2E-TAX-B', contact: '合成联系人乙', phone: '13900000022' },
  ]) {
    test(`客户校验、正式保存、别名搜索、显式编辑与冷回读：${input.alias}`, async ({ page }) => {
      await page.goto('/base/customer/form')
      const footer = page.getByRole('group', { name: '表单操作' })
      await footer.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect(page.getByText('客户名称为必填项', { exact: true })).toBeVisible()
      await page.getByLabel('客户名称 *').fill(input.name)
      await page.getByLabel('简称/别名').fill(input.alias)
      await page.getByLabel('统一社会信用代码').fill(input.taxNo)
      await page.getByLabel(/^联系人\s*\*/).fill(input.contact)
      await footer.getByRole('button', { name: '保存并提交', exact: true }).click()
      await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
      await page.getByRole('link', { name: '返回客户列表', exact: true }).click()
      await page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' }).fill(input.alias)
      await page.getByRole('link', { name: input.name, exact: true }).click()
      await page.getByRole('link', { name: '编辑客户', exact: true }).click()
      await expect(page.getByLabel('客户名称 *')).toHaveValue(input.name)
      await expect(page.getByLabel('统一社会信用代码')).toHaveValue(input.taxNo)
      await page.getByLabel('联系电话').fill(input.phone)
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
      await page.getByRole('link', { name: '编辑客户', exact: true }).click()
      await expect(page.getByLabel('联系电话')).toHaveValue(input.phone)
      await expect(page.getByLabel('简称/别名')).toHaveValue(input.alias)
    })
  }
  // 有项目的预算保存完整旅程由 target-cost-central.spec.ts 保留。
  for (const name of ['未关联项目的合成预算甲', '未关联项目的合成预算乙']) {
    for (const action of ['保存草稿', '保存'] as const) {
      test(`中央预算缺项目的${action}边界：${name}`, async ({ page }) => {
        await page.goto('/project/target-cost/form?origin=real')
        await page.getByLabel('版本名 *').fill(name)
        await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: action, exact: true }).click()
        if (action === '保存草稿') {
          await expect.poll(() => new URL(page.url()).pathname).toBe('/project/target-cost')
          await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
          await page.reload()
          await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
          return
        }
        await expect(page.getByText('请选择项目', { exact: true })).toBeVisible()
        await expect(page.getByRole('combobox', { name: '检索项目' })).toBeFocused()
        await expect(page.getByLabel('版本名 *')).toHaveValue(name)
        expect(new URL(page.url()).pathname).toBe('/project/target-cost/form')
      })
    }
  }
})
