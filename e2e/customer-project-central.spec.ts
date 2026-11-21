import type { Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })

const CUSTOMER_INPUTS = [
  { label: '整数与施工阶段', marker: '甲', contact: '受控联系人甲', manager: '受控经理甲', stage: '施工中', date: '2026-09-09', amount: 123400, secondaryAmount: 456700, editedAmount: '234500', editedFormatted: '234,500.00' },
  { label: '小数与闰日筹备阶段', marker: '乙', contact: '受控联系人乙', manager: '受控经理乙', stage: '筹备中', date: '2024-02-29', amount: 113.25, secondaryAmount: 226.5, editedAmount: '226.5', editedFormatted: '226.50' },
] as const

for (const input of CUSTOMER_INPUTS) {
  test.describe(input.label, () => {
    const named = (base: string) => `${base}-${input.marker}`
    test.setTimeout(120_000)

    function headers(info: TestInfo) {
      return { 'x-ruihang-test-session': `customer-project-${Buffer.from(info.testId).toString('base64url')}` }
    }

    async function reset(page: Page, info: TestInfo) {
      for (const entity of ['projects', 'customers']) {
        const result = await page.context().request.post(`/api/testing/${entity}/reset`, {
          headers: { ...headers(info), 'x-ruihang-test-reset': '1' },
          data: { scenario: 'ready' },
        })
        expect(result.ok()).toBe(true)
      }
    }

    async function save(page: Page, entity: 'customers' | 'projects', draft: Record<string, unknown>, commandId: string) {
      return page.evaluate(async ({ entity, draft, commandId }) => {
        const context = await (await fetch('/api/read/business-session')).json()
        const response = await fetch(`/api/commands/${entity}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...context,
            requiredCapability: entity === 'customers' ? 'customer:write' : 'project:write',
            commandId,
            baseVersion: null,
            action: 'save',
            draft,
            attachments: {},
          }),
        })
        const result = await response.json()
        if (!response.ok)
          throw new Error(`合成 ${entity} 保存失败：${JSON.stringify(result)}`)
        return result as { id: string, version: string }
      }, { entity, draft, commandId })
    }

    async function updateProject(page: Page, id: string, patch: Record<string, unknown>) {
      await page.evaluate(async ({ id, patch }) => {
        const context = await (await fetch('/api/read/business-session')).json()
        const form = await (await fetch(`/api/read/projects/${id}/form`)).json()
        const response = await fetch(`/api/commands/projects/${id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...context, id, requiredCapability: 'project:write', commandId: crypto.randomUUID(), baseVersion: form.version, action: 'save', draft: { ...form.draft, ...patch }, attachments: {} }),
        })
        if (!response.ok)
          throw new Error(`合成项目更新失败：${response.status}`)
      }, { id, patch })
    }

    async function readCustomer(page: Page, id: string) {
      return page.evaluate(async id => (await (await fetch(`/api/read/customers/${id}?origin=real&includeDemo=false`)).json()), id)
    }

    test.beforeEach(async ({ page }, info) => {
      await page.context().setExtraHTTPHeaders(headers(info))
      await page.setExtraHTTPHeaders(headers(info))
      await page.clock.install({ time: new Date(`${input.date}T04:00:00Z`) })
      await reset(page, info)
      await page.goto('/base/customer')
      await expect(page.getByRole('heading', { name: '客户档案', exact: true })).toBeVisible({ timeout: 30_000 })
    })

    test.afterEach(async ({ page }, info) => {
      await reset(page, info)
    })

    test('正式项目保存后同一客户详情返回关联身份、数量并往返项目详情', async ({ page }) => {
      const customer = await save(page, 'customers', { name: named('合成关联客户407'), contact: input.contact }, 'customer-create')
      const project = await save(page, 'projects', { name: named('合成关联项目408'), customerId: customer.id, manager: input.manager, status: input.stage }, 'project-create')
      const form = await page.evaluate(async id => (await (await fetch(`/api/read/projects/${id}/form`)).json()), project.id)
      expect(form.draft.customerId).toBe(customer.id)
      await page.goto(`/base/customer/${customer.id}?origin=real`)
      await expect(page.getByRole('heading', { name: named('合成关联客户407'), exact: true })).toBeVisible()
      const detail = await page.evaluate(async id => (await (await fetch(`/api/read/customers/${id}?origin=real&includeDemo=false`)).json()), customer.id)
      expect(detail.summary.projectCount, '中央项目已保存，客户详情应从同一事实源回读').toBe(1)
      expect(detail.projects[0].project).toMatchObject({ id: project.id, label: named('合成关联项目408'), state: 'resolved' })
      const link = page.getByRole('link', { name: named('合成关联项目408'), exact: true })
      await expect(link).toHaveAttribute('href', new RegExp(`/project/${project.id}\\?origin=real&returnTo=`))
      await link.click()
      await expect(page.getByRole('heading', { name: named('合成关联项目408'), exact: true })).toBeVisible()
      await page.reload()
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(page.getByRole('tab', { name: /名下项目/ })).toHaveAttribute('aria-selected', 'true')
      await expect(link).toBeFocused()
    })

    test('真实 Excel 导入主次客户，同名不同 ID 不误接，五档视口检查局部横滚、键盘与浮层', async ({ page }) => {
      const a = await save(page, 'customers', { name: named('同名合成客户424'), contact: '主客户联系人' }, 'a')
      const b = await save(page, 'customers', { name: named('同名合成客户424'), contact: '次客户联系人' }, 'b')
      const c = await save(page, 'customers', { name: named('同名合成客户424'), contact: '未关联联系人' }, 'c')
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ['项目名称', '客户', '次客户', '项目经理', '业务流程阶段'],
        [named('Excel关联项目424'), a.id, b.id, named('合成经理424'), '施工中'],
      ]), '关联项目')
      await page.goto('/project')
      await page.getByRole('button', { name: '导入项目', exact: true }).click()
      await page.getByLabel('选择导入文件').setInputFiles({ name: '关联项目424.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(book, { type: 'array', bookType: 'xlsx' })) })
      await page.getByRole('button', { name: '使用此工作表' }).click()
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await expect(page.getByRole('region', { name: '客户身份与阶段核对表' })).toContainText(b.id)
      await page.getByRole('button', { name: '开始导入', exact: true }).click()
      await expect(page).toHaveURL(/\/project$/)
      const primary = await readCustomer(page, a.id)
      expect(primary.summary.projectCount).toBe(1)
      expect(primary.projects[0].relationRole).toBe('主客户')
      const secondary = await readCustomer(page, b.id)
      expect(secondary.projects[0]).toMatchObject({ relationRole: '次客户', project: { id: primary.projects[0].project.id } })
      expect((await readCustomer(page, c.id)).projects).toEqual([])
      await page.goto(`/base/customer/${b.id}?origin=real`)
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 })
        const link = page.getByRole('link', { name: named('Excel关联项目424'), exact: true })
        await expect(link).toBeVisible()
        await expect(page.getByRole('tabpanel', { name: '名下项目' })).toContainText('次客户')
        await expectNoPageOverflow(page, `客户关联项目 @ ${width}`)
        const table = page.locator('[data-customer-relations] .vxe-table--scroll-x-handle').first()
        await expect.poll(() => table.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
        await link.focus()
        await expect(link).toBeFocused()
        const scrollLeft = await table.evaluate((element) => {
          element.scrollLeft = Math.min(110, element.scrollWidth - element.clientWidth)
          return element.scrollLeft
        })
        expect(scrollLeft).toBeGreaterThan(0)
        await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
        await page.screenshot({ path: `.cache/customer-project-slice/customer-project-${width}.png` })
        await link.press('Enter')
        await expect(page.getByRole('heading', { name: named('Excel关联项目424'), exact: true })).toBeVisible()
        await expectNoPageOverflow(page, `关联项目详情 @ ${width}`)
        await page.reload()
        const back = page.getByRole('link', { name: '返回客户详情', exact: true })
        await back.focus()
        await back.press('Enter')
        await expect(link).toBeFocused()
        await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
        await page.getByRole('button', { name: '包含测试数据' }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expectNoPageOverflow(page, `来源确认浮层 @ ${width}`)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
      }
    })

    test('项目更换客户、客户改名后重新打开和刷新均回读最新稳定关系', async ({ page }) => {
      const a = await save(page, 'customers', { name: named('旧合成客户424'), contact: input.contact }, 'a')
      const b = await save(page, 'customers', { name: named('新合成客户424'), contact: input.contact }, 'b')
      const p = await save(page, 'projects', { name: named('更换归属项目424'), manager: input.manager, customerId: a.id }, 'p')
      await page.goto(`/base/customer/${a.id}?origin=real`)
      await expect(page.getByRole('link', { name: named('更换归属项目424'), exact: true })).toBeVisible()
      await updateProject(page, p.id, { customerId: b.id, secondaryCustomerId: null })
      await page.reload()
      await expect(page.getByRole('link', { name: named('更换归属项目424'), exact: true })).toHaveCount(0)
      expect((await readCustomer(page, a.id)).summary.projectCount).toBe(0)
      await page.goto(`/base/customer/${b.id}?origin=real`)
      await expect(page.getByRole('link', { name: named('更换归属项目424'), exact: true })).toBeVisible()
      await page.getByRole('link', { name: '编辑客户' }).click()
      await expect(page.getByLabel('客户名称 *')).toHaveValue(named('新合成客户424'))
      await page.getByLabel('客户名称 *').fill(named('客户更名后424'))
      const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes(`/api/commands/customers/${b.id}`))
      await page.getByRole('button', { name: '保存', exact: true }).click()
      expect((await saved).ok()).toBe(true)
      await expect(page.getByRole('heading', { name: named('客户更名后424'), exact: true })).toBeVisible()
      await page.reload()
      expect((await readCustomer(page, b.id)).projects[0].project.id).toBe(p.id)
      await page.getByRole('link', { name: named('更换归属项目424'), exact: true }).click()
      await expect(page.getByRole('heading', { name: named('更换归属项目424'), exact: true })).toBeVisible()
      const projectRead = await page.evaluate(async id => (await (await fetch(`/api/read/projects/${id}?origin=real&includeDemo=false`)).json()), p.id)
      expect(projectRead.item.customer).toMatchObject({ id: b.id, label: named('客户更名后424') })
      await expect(page.getByText(named('客户更名后424'), { exact: true }).last()).toBeVisible()
    })

    test('项目源无权、服务失败与重试不显示假零或受限身份；正式和演示隔离', async ({ page }, info) => {
      const a = await save(page, 'customers', { name: named('权限合成客户424'), contact: input.contact }, 'a')
      await save(page, 'projects', { name: named('受限合成项目424'), manager: input.manager, customerId: a.id }, 'p')
      for (const scenario of ['forbidden', 'unavailable']) {
        await page.context().request.post('/api/testing/projects/reset', { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario } })
        await page.goto(`/base/customer/${a.id}?origin=real`)
        await expect(page.getByRole('heading', { name: named('权限合成客户424'), exact: true })).toBeVisible()
        await expect(page.getByRole(scenario === 'forbidden' ? 'status' : 'alert', { name: scenario === 'forbidden' ? '无权查看关联项目' : '关联项目加载失败' })).toBeVisible()
        const data = await readCustomer(page, a.id)
        expect(data.summary.projectCount).toBeNull()
        expect(data.projects).toEqual([])
        await expect(page.getByRole('tabpanel', { name: '名下项目' })).not.toContainText('暂无名下项目')
        await expectNoPageOverflow(page, `关联项目${scenario}`)
      }
      await page.context().request.post('/api/testing/projects/reset', { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
      await save(page, 'projects', { name: named('重试恢复项目424'), manager: input.manager, customerId: a.id }, 'retry-p')
      await page.getByRole('button', { name: '重新加载关联项目' }).click()
      await expect(page.getByRole('link', { name: named('重试恢复项目424'), exact: true })).toBeVisible()
      await page.getByRole('button', { name: '包含测试数据' }).click()
      const switched = page.waitForResponse(response => response.url().includes(`/api/read/customers/${a.id}?`) && response.url().includes('includeDemo=true'))
      await page.getByRole('button', { name: '确认切换' }).click()
      await switched
      await expect(page.getByRole('button', { name: '关闭测试数据' })).toBeVisible()
      expect((await readCustomer(page, a.id)).summary.projectCount).toBe(1)
      await page.goto('/base/customer/customer_demo_003?origin=demo')
      await expect(page.getByRole('heading', { name: '翠湖投资', exact: true })).toBeVisible()
      await expect(page.getByRole('tabpanel', { name: '名下项目' })).not.toContainText(named('重试恢复项目424'))
      await expect(page.locator('[data-customer-project-id]')).toHaveCount(0)
    })

    test('项目详情读取失败保留已捕获客户来源；直接深链、伪造和过期来源退回规范项目列表', async ({ page }) => {
      const a = await save(page, 'customers', { name: named('返回合成客户424'), contact: input.contact }, 'a')
      const p = await save(page, 'projects', { name: named('返回合成项目424'), manager: input.manager, customerId: a.id }, 'p')
      await page.goto(`/base/customer/${a.id}?origin=real`)
      const link = page.getByRole('link', { name: named('返回合成项目424'), exact: true })
      await expect(link).toBeVisible()
      await page.route(`**/api/read/projects/${p.id}?**`, route => route.abort('connectionreset'))
      await link.click()
      await expect(page).toHaveURL(new RegExp(`/project/${p.id}\\?`))
      const capturedUrl = page.url()
      await expect(page.getByRole('alert')).toBeVisible()
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(link).toBeFocused()
      await page.unroute(`**/api/read/projects/${p.id}?**`)
      await page.goto(`/project/${p.id}?origin=real`)
      await expect(page.getByRole('link', { name: '返回项目列表', exact: true })).toHaveAttribute('href', '/project')
      await page.goto(`/project/${p.id}?origin=real&returnTo=https%3A%2F%2Fevil.example`)
      await expect(page.getByRole('link', { name: '返回项目列表', exact: true })).toHaveAttribute('href', '/project')
      await page.evaluate(() => {
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('ruihang:customer-relation-return:')) {
            const value = JSON.parse(sessionStorage.getItem(key)!)
            value.expiresAt = 1
            sessionStorage.setItem(key, JSON.stringify(value))
          }
        }
      })
      await page.goto(capturedUrl)
      await expect(page.getByRole('heading', { name: named('返回合成项目424'), exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: '返回项目列表', exact: true })).toHaveAttribute('href', '/project')
    })

    test('客户列表筛选分页与应用页签经项目往返和刷新保留，关系区滚动和原链接焦点恢复', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 480 })
      const ids: string[] = []
      for (let i = 1; i <= 22; i++) {
        ids.push((await save(page, 'customers', { name: `列表往返合成-${input.marker}${String(i).padStart(2, '0')}`, contact: input.contact, status: 'active' }, `c-${i}`)).id)
      }
      const customerId = ids[10]!
      await save(page, 'projects', { name: named('列表往返项目424'), customerId, manager: input.manager }, 'p')
      await page.goto(`/base/customer?search=${encodeURIComponent(`列表往返合成-${input.marker}`)}&status=active&sort=name-asc&page=2&pageSize=10`)
      const customerLink = page.getByRole('link', { name: `列表往返合成-${input.marker}11`, exact: true }).first()
      await expect(customerLink).toBeVisible()
      await customerLink.click()
      const projectLink = page.getByRole('link', { name: named('列表往返项目424'), exact: true })
      await expect(projectLink).toBeVisible()
      await projectLink.focus()
      const workspace = page.locator('[data-shell-workspace]')
      const scroll = await workspace.evaluate((element) => {
        element.scrollTop = Math.min(200, element.scrollHeight - element.clientHeight)
        return element.scrollTop
      })
      expect(scroll).toBeGreaterThan(0)
      await projectLink.press('Enter')
      await expect(page.getByRole('heading', { name: named('列表往返项目424'), exact: true })).toBeVisible()
      await page.reload()
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(projectLink).toBeFocused()
      await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(scroll)
      await page.reload()
      await expect(projectLink).toBeFocused()
      await page.getByRole('link', { name: '返回客户列表', exact: true }).click()
      await expect(page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' })).toHaveValue(`列表往返合成-${input.marker}`)
      await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('combobox', { name: '排序' })).toContainText('名称升序')
      await expect(page.getByRole('button', { name: '档案状态，已选 1 项' })).toContainText('有效')
      await expect(page.getByLabel('每页条数')).toHaveValue('10')
      await expect(customerLink).toBeFocused()
      await expect(page.locator('[data-tab-trigger][aria-current="page"]')).toContainText('客户')
    })
  })
}
