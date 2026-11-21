import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { EQUIVALENT_200_PERCENT_VIEWPORT, expectInViewport, expectLocalHorizontalScroll, expectNoPageOverflow, expectTabSequence } from './helpers/responsive'

test.describe('应用壳', () => {
  const ROUTES_FOR_OVERFLOW = [
    '项目列表',
    '施工合同',
    '分包合同',
    '工程量管理',
    '材料采购合同',
    '发票台账',
    '分供方',
    '费用报销',
    '库存盘点',
  ] as const

  async function openSidebarRoute(page: Page, label: string) {
    const sidebar = page.locator('[data-sidebar="sidebar"]').first()
    const navSearch = sidebar.getByRole('searchbox', { name: '搜索菜单' })
    // 分组导航按当前路由保持单组展开；跨组操作应走共享搜索，而不是依赖
    // 某个非当前分组恰好保持展开。这样验收的是真实用户可达路径。
    await navSearch.fill(label)
    const link = sidebar.getByRole('link', { name: label, exact: true })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.locator('[data-shell-topbar] h1')).toHaveText(label)
  }

  async function openOverflowingTabs(page: Page) {
    for (const label of ROUTES_FOR_OVERFLOW)
      await openSidebarRoute(page, label)
  }

  async function openTabs(page: Page, labels: readonly string[]) {
    for (const label of labels)
      await openSidebarRoute(page, label)
  }

  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `shell-ui-${randomUUID()}` })
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
    await page.addInitScript(() => {
      localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
      localStorage.setItem('ruihang-sidebar-pinned', 'true')
      localStorage.removeItem('ruihang-sidebar-groups')
    })
  })

  test('首页项目读取迟到时，侧栏跳转仍能完成', async ({ page }) => {
    let releaseProjectRead!: () => void
    let releaseRouteModule!: () => void
    let markProjectRead!: () => void
    let markRouteModule!: () => void
    const projectRead = new Promise<void>((resolve) => {
      markProjectRead = resolve
    })
    const routeModule = new Promise<void>((resolve) => {
      markRouteModule = resolve
    })
    const projectGate = new Promise<void>((resolve) => {
      releaseProjectRead = resolve
    })
    const routeGate = new Promise<void>((resolve) => {
      releaseRouteModule = resolve
    })
    await page.route(/\/api\/read\/projects\/[^/?]+(?:\?|$)/, async (route) => {
      markProjectRead()
      await projectGate
      await route.continue()
    })
    // 只延迟真正的页面模块，不能拦截启动时收集路由元信息的 ?macro=true 请求。
    await page.route('**/_nuxt/pages/project/index.vue', async (route) => {
      markRouteModule()
      await routeGate
      await route.continue()
    })
    try {
      await page.setViewportSize({ width: 1024, height: 900 })
      // 受控的异步请求故意保持未完成；按页面可见状态继续，不能等待整个文档 load。
      await page.goto('/', { waitUntil: 'commit' })
      await projectRead
      const sidebar = page.locator('[data-sidebar="sidebar"]').first()
      await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill('项目列表')
      await sidebar.getByRole('link', { name: '项目列表', exact: true }).click()
      await routeModule
      releaseProjectRead()
      await expect(page.getByTestId('project-switcher-trigger')).not.toContainText('正在加载项目')
      releaseRouteModule()
      await expect(page).toHaveURL('/project')
      await expect(page.locator('[data-shell-topbar] h1')).toHaveText('项目列表')
    }
    finally {
      releaseProjectRead()
      releaseRouteModule()
    }
  })

  test('Issue #188：导航搜索与页签溢出均可由键盘可达控件操作', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const navSearch = page.getByRole('searchbox', { name: '搜索菜单' })
    await navSearch.fill('合同')
    const firstResult = page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: '施工合同' })
    await expect(firstResult).toBeVisible()
    await expect(firstResult).toBeInViewport()
    await expect(page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: '项目列表' })).toHaveCount(0)
    await navSearch.fill('')

    await openOverflowingTabs(page)

    const tabList = page.getByRole('navigation', { name: '已打开页面' })
    const previous = page.getByRole('button', { name: '向前翻动页签' })
    const next = page.getByRole('button', { name: '向后翻动页签' })

    await expect(previous).toBeVisible()
    await expect(next).toBeVisible()
    await expect(next).toBeEnabled()
    expect(await tabList.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)

    const before = await tabList.evaluate(element => element.scrollLeft)
    await next.click()
    await expect.poll(() => tabList.evaluate(element => element.scrollLeft)).toBeGreaterThan(before)

    const afterNext = await tabList.evaluate(element => element.scrollLeft)
    await previous.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => tabList.evaluate(element => element.scrollLeft)).toBeLessThan(afterNext)

    const sidebarFrame = page.locator('[data-sidebar="sidebar"]').first().locator('..')
    await page.getByRole('button', { name: '收起侧栏' }).click()
    await page.mouse.move(800, 700)
    await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(48)
    await expect(previous).toHaveCount(0)
    await expect(next).toHaveCount(0)
    await sidebarFrame.hover()
    await expect(sidebarFrame).toHaveAttribute('data-peek-open', 'true')
    await page.mouse.move(800, 700)
    await expect(sidebarFrame).not.toHaveAttribute('data-peek-open', 'true')
    await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(48)
    await expect(page.locator('[data-overlay-backdrop]')).toHaveCount(0)

    await page.getByRole('button', { name: '固定侧栏' }).click()
    await expect.poll(async () => Math.round((await sidebarFrame.boundingBox())?.width ?? 0)).toBe(208)
    await expect(previous).toBeVisible()
    await expect(next).toBeVisible()
  })

  for (const supplier of [
    { name: '广州市大板东建材有限公司', id: 'sup_demo_001' },
    { name: '穗建五金机电经营部', id: 'sup_demo_004' },
  ]) {
    test(`Issue #188：只读演示详情标题会重新计算页签溢出：${supplier.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 800 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await openTabs(page, ROUTES_FOR_OVERFLOW)
      await openSidebarRoute(page, '分供方')

      const tabList = page.getByRole('navigation', { name: '已打开页面' })
      const next = page.getByRole('button', { name: '向后翻动页签' })
      await expect(next).toHaveCount(0)
      expect(await tabList.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

      let release!: () => void
      const pending = new Promise<void>(resolve => release = resolve)
      await page.route(`**/api/read/suppliers/${supplier.id}?*`, async (route) => {
        const response = await route.fetch()
        await pending
        await route.fulfill({ response })
      })
      await page.getByRole('searchbox', { name: '搜索关键词…' }).fill(supplier.name)
      await page.getByRole('link', { name: supplier.name, exact: true }).click()
      try {
        await expect(tabList.getByRole('button', { name: '分供方详情', exact: true })).toHaveAttribute('aria-current', 'page')
        const geometry = await tabList.evaluate((element) => {
          const bounds = [...element.querySelectorAll('[data-shell-tab]')].map(item => item.getBoundingClientRect())
          const style = getComputedStyle(element)
          return { client: element.clientWidth, content: Math.max(...bounds.map(rect => rect.right)) - Math.min(...bounds.map(rect => rect.left)) + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight) }
        })
        const width = Math.ceil(1440 - geometry.client + geometry.content + 8)
        expect(width).toBeGreaterThanOrEqual(1024)
        await page.setViewportSize({ width, height: 800 })
        await expect(next).toHaveCount(0)
        expect(await tabList.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
      finally { release() }
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/base/supplier/${supplier.id}`)
      expect(new URL(page.url()).searchParams.get('origin')).toBe('demo')
      await expect(page.getByRole('heading', { name: supplier.name, exact: true })).toBeVisible()
      await expect(page.locator('[data-shell-topbar] h1')).toHaveText('分供方详情')
      await expect(tabList.getByRole('button', { name: supplier.name, exact: true })).toHaveAttribute('aria-current', 'page')

      await expect(next).toBeVisible()
      expect(await tabList.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    })
  }

  for (const sample of [
    { width: 390, height: 844, placement: 'bottom' },
    { width: 768, height: 900, placement: 'bottom' },
    { width: 1024, height: 900, placement: 'right' },
    { width: 1280, height: 900, placement: 'right' },
    { width: 1440, height: 1000, placement: 'right' },
  ] as const) {
    test(`Issue #188：通知 Sheet @ ${sample.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: sample.width, height: sample.height })
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const trigger = page.getByRole('button', { name: /^打开通知中心/ })
      await trigger.click()

      const sheet = page.getByRole('dialog', { name: '消息中心' })
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveAttribute('data-sheet-placement', sample.placement)
      await expect(page.locator('[data-shell-workspace]')).toHaveCSS('overflow-y', 'hidden')
      await sheet.evaluate(element =>
        Promise.all(element.getAnimations().map(animation => animation.finished)),
      )

      const box = await sheet.boundingBox()
      expect(box).not.toBeNull()
      if (sample.placement === 'bottom') {
        await expect(sheet.locator('[data-sheet-handle]')).toBeVisible()
        expect(Math.round(box!.width)).toBe(sample.width)
        expect(Math.round(box!.y + box!.height)).toBe(sample.height)
      }
      else {
        await expect(sheet.locator('[data-sheet-handle]')).toHaveCount(0)
        expect(Math.round(box!.width)).toBe(390)
        expect(Math.round(box!.x + box!.width)).toBe(sample.width)
      }

      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await expect(trigger).toBeFocused()
      await expect(page.locator('[data-shell-workspace]')).toHaveCSS('overflow-y', 'auto')
    })
  }
})

test.describe('详情壳', () => {
  const VIEWPORT_WIDTHS = [390, 768, 1024, 1280, 1440] as const
  const VIEWPORT_HEIGHTS: Record<(typeof VIEWPORT_WIDTHS)[number], number> = {
    390: 844,
    768: 900,
    1024: 900,
    1280: 900,
    1440: 1000,
  }

  test.describe('Issue #186：统一实体详情壳', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
      await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
    })
    for (const state of [
      { button: '加载', role: 'status', title: '正在加载分供方详情演示' },
      { button: '空数据', role: 'status', title: '该分供方还没有业务数据' },
      { button: '无权限', role: 'status', title: '无权查看该分供方' },
      { button: '不存在', role: 'status', title: '分供方不存在或已删除' },
      { button: '错误', role: 'alert', title: '分供方详情加载失败' },
    ] as const) {
      test(`详情壳独立呈现 ${state.button} 状态与可用恢复动作`, async ({ page }) => {
        await page.goto('/dev/detail-shell')
        const controls = page.getByRole('group', { name: '详情壳状态预览' })

        await controls.getByRole('button', { name: state.button, exact: true }).click()
        const panel = page.getByRole(state.role, { name: state.title })
        await expect(panel).toBeVisible()
        await expect(page.getByRole('progressbar')).toHaveCount(0)
        if (state.button === '不存在') {
          await expect(page.getByRole('link', { name: '返回 KitUI 演示' }))
            .toHaveAttribute('href', '/dev/kit-ui')
        }
        if (state.role === 'alert') {
          await panel.getByRole('button', { name: '重新加载' }).click()
          await expect(page.getByRole('heading', {
            name: '华南区域机电设备与建筑辅材长期战略合作分供方有限公司',
          })).toBeVisible()
        }
        else {
          await expect(page.getByRole('alert')).toHaveCount(0)
        }
      })
    }

    test('长标题、业务页签与右栏在各宽度保持可用', async ({ page }) => {
      await page.goto('/dev/detail-shell')

      const shell = page.locator('[data-ui="entity-detail-shell"]')
      const body = shell.locator('[data-ui="entity-detail-body"]')
      const heading = shell.getByRole('heading', {
        name: '华南区域机电设备与建筑辅材长期战略合作分供方有限公司',
      })
      await expect(heading).toBeVisible()

      const tabs = page.getByRole('navigation', { name: '详情壳业务页签' })
      const firstTab = tabs.getByRole('tab', { name: '合同与结算事实 2', exact: true })
      await firstTab.focus()
      await page.keyboard.press('ArrowRight')
      await expect(tabs.getByRole('tab', { name: '跨项目收票与税额明细 1', exact: true }))
        .toHaveAttribute('aria-selected', 'true')

      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
        await expect(heading).toBeVisible()
        await expect(shell.getByRole('complementary', { name: '文件与动态' })).toBeVisible()

        await expect.poll(() => body.evaluate(element =>
          getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
        ), { message: `${width}px` }).toBe(width >= 1280 ? 2 : 1)

        await expectNoPageOverflow(page, `详情壳 @ ${width}px`)
      }

      await page.goto('/base/supplier/sup_demo_004?origin=demo')
      const realShell = page.locator('[data-ui="entity-detail-shell"]')
      await expect(realShell.getByRole('heading', { name: '穗建五金机电经营部' }))
        .toBeVisible()
      const factTabs = page.getByRole('navigation', { name: '分供方业务事实' }).getByRole('tab')
      await expect(factTabs).toHaveText([/^\s*详细资料\s*$/, /^\s*合作项目\s*(?:\d+\s*)?$/, /^\s*支出合同\s*(?:\d+\s*)?$/, /^\s*支出结算\s*(?:\d+\s*)?$/, /^\s*收票登记\s*(?:\d+\s*)?$/, /^\s*付款管理\s*(?:\d+\s*)?$/])
      await expect(page.getByTestId('supplier-summary')).toContainText('累计合同金额')
      await expect(page.getByTestId('supplier-summary')).toContainText('¥261,250.00')
      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
        await expectNoPageOverflow(page, `真实分供方详情 @ ${width}px`)
      }
    })

    test('窄窗键盘顺序稳定且密集子表只在自身区域横滚', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/dev/detail-shell')

      const back = page.getByRole('link', { name: '返回 KitUI 演示' })
      const compliance = page.getByRole('button', { name: '合规提醒' })
      const edit = page.getByRole('button', { name: '编辑', exact: true })
      await expectTabSequence(page, back, [compliance, edit], '详情壳头部操作')
      await expectInViewport(edit, '详情壳窄窗编辑操作')

      await expectLocalHorizontalScroll(
        page.getByTestId('detail-shell-table-scroll'),
        '详情壳密集子表',
      )
      await expectNoPageOverflow(page, '详情壳密集子表 @ 390px')
    })
  })
})

test.describe('表单壳', () => {
  const VIEWPORT_WIDTHS = [390, 768, 1024, 1280, 1440] as const

  test.describe('Issue #187：统一整页表单壳', () => {
    test.beforeEach(async ({ page }) => {
      await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `form-shell-${randomUUID()}` })
      await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
      await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
    })

    for (const input of [
      { name: '待校验焦点材料分供方', category: '材料供应商', contact: '合成联系人甲' },
      { name: '待校验焦点专业分供方', category: '专业分包商', contact: '合成联系人乙' },
    ]) {
      test(`新建自动聚焦、双通道校验与正式编辑回显：${input.category}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 600 })
        await page.goto('/base/supplier/form')

        const companyName = page.getByLabel('公司全称 *')
        const saveSubmit = page.getByRole('group', { name: '表单操作' })
          .getByRole('button', { name: '保存并提交' })
        await expect(page.getByRole('heading', { name: '新建 · 分供方' })).toBeVisible({ timeout: 15_000 })
        await expect(companyName).toBeFocused()

        await page.keyboard.press('Tab')
        await expect(page.getByText('公司全称为必填项', { exact: true })).toBeVisible()
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)

        await saveSubmit.click()
        await expect(page.getByText('公司全称为必填项', { exact: true })).toBeVisible()
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: '公司全称为必填项' }))
          .toBeVisible()
        await expect(companyName).toBeFocused()

        await companyName.fill(input.name)
        await page.getByLabel('分供方类别 *').selectOption(input.category)
        const contact = page.getByLabel('主要联系人 *')
        await expect(contact).not.toBeInViewport()
        await saveSubmit.click()
        await expect(page.getByText('主要联系人为必填项', { exact: true })).toBeVisible()
        await expect(contact).toBeFocused()
        await expect(contact).toBeInViewport()

        await contact.fill(input.contact)
        const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/suppliers') && response.request().method() === 'POST')
        await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
        const response = await saved
        expect(response.ok(), await response.text()).toBe(true)
        const { id } = await response.json()
        await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
        await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
        await expect.poll(() => new URL(page.url()).pathname).toBe(`/base/supplier/form/${id}`)
        await expect(page.getByRole('heading', { name: '编辑 · 分供方' })).toBeVisible()
        await expect(page.getByLabel('公司全称 *')).toHaveValue(input.name)
        await expect(page.getByLabel('主要联系人 *')).toHaveValue(input.contact)
        await expect(page.getByLabel('公司全称 *')).toBeFocused()
      })
    }

    for (const input of [
      { label: '目标成本中央提交', path: '/project/target-cost/form?origin=real', nameLabel: '版本名 *', name: '待校验目标成本', lookup: '检索项目', message: '请选择项目', errorId: 'target-cost-project-error', blur: false },
      { label: '项目失焦与提交', path: '/project/form', nameLabel: '项目名称 *', name: '待校验项目', lookup: '检索客户', message: '客户为必填项', errorId: 'project-customer-error', blur: true },
    ]) {
      test(`必填 LookupSelect 显示独立错误并定位首错：${input.label}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 520 })

        await page.goto(input.path)
        await page.waitForLoadState('networkidle')
        const name = page.getByLabel(input.nameLabel)
        if (input.blur)
          await expect(name).toBeFocused()
        await name.fill(input.name)
        const lookup = page.getByRole('combobox', { name: input.lookup })
        if (input.blur) {
          await lookup.focus()
          await page.keyboard.press('Tab')
          await expect(page.getByText(input.message, { exact: true })).toBeVisible()
        }
        await page.getByRole('group', { name: '表单操作' })
          .getByRole('button', { name: '保存并提交' })
          .click()
        await expect(page.getByText(input.message, { exact: true })).toBeVisible()
        await expect(lookup).toHaveAttribute('aria-invalid', 'true')
        await expect(lookup).toHaveAttribute('aria-describedby', input.errorId)
        await expect(lookup).toBeFocused()
        await expect(lookup).toBeInViewport()
      })
    }

    test('分区、字段与吸底动作在各宽度保持可达', async ({ page }) => {
      await page.goto('/base/supplier/form')

      const shell = page.locator('[data-ui="entity-form-shell"]')
      await expect(shell).toBeVisible()
      const footer = shell.getByRole('group', { name: '表单操作' })
      const sections = shell.getByRole('navigation', { name: '表单分区' })
      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        })
        await expect(footer).toHaveCSS('position', 'sticky')
        await expect(footer).toBeInViewport()
        await expect(sections).toBeHidden()
        await expectNoPageOverflow(page, `统一表单壳 @ ${width}px`)
      }
    })

    test('200% 等效宽度与页签切换保值，放弃确认关闭后归还焦点', async ({ page }) => {
      await page.setViewportSize(EQUIVALENT_200_PERCENT_VIEWPORT)
      await page.goto('/base/supplier/form')
      await expectNoPageOverflow(page, '统一表单壳 @ 200% 等效宽度')

      const companyName = page.getByLabel('公司全称 *')
      await companyName.fill('未保存的分供方页签草稿')
      await page.getByRole('button', { name: '切换侧边栏' }).click()
      await page.getByRole('dialog', { name: '导航菜单' })
        .getByRole('link', { name: /班组管理/ })
        .click()
      await expect(page).toHaveURL('/base/crew')
      await expect(page.getByRole('dialog', { name: '放弃修改' })).toHaveCount(0)

      await page.getByRole('navigation', { name: '已打开页面' })
        .getByRole('button', { name: '新建 · 分供方', exact: true })
        .click()
      await expect(companyName).toHaveValue('未保存的分供方页签草稿')

      const cancel = page.getByRole('group', { name: '表单操作' })
        .getByRole('button', { name: '取消', exact: true })
      await cancel.click()
      const dialog = page.getByRole('dialog', { name: '放弃修改' })
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(cancel).toBeFocused()

      await cancel.click()
      await dialog.getByRole('button', { name: '放弃修改', exact: true }).click()
      await expect(page).toHaveURL('/base/supplier')
    })
  })
})
