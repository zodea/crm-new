import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const REPRESENTATIVE_FORMS = [
  {
    path: '/base/supplier/form',
    title: '新建 · 分供方',
  },
  {
    path: '/finance/payment/new',
    title: '新建 · 付款申请',
    prepare: async (page: Page) => {
      await expect(page.getByRole('heading', { name: '选择付款业务类型' })).toBeVisible()
      await page.getByRole('button', { name: '有合同-材料', exact: true }).click()
    },
  },
  {
    path: '/material/arrival/new',
    title: '新建 · 材料到货',
  },
  {
    path: '/owner/report/new',
    title: '新建 · 甲方报量',
  },
  {
    path: '/contract/material/form',
    title: '新建 · 材料采购合同',
  },
] as const

async function expectNoPageOverflow(page: Page, context: string) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll, `${context} 不应产生页面级横向溢出`)
    .toBeLessThanOrEqual(widths.client)
}

async function openRepresentativeForm(
  page: Page,
  form: typeof REPRESENTATIVE_FORMS[number],
) {
  await page.goto(form.path)
  if ('prepare' in form)
    await form.prepare(page)
  await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
    timeout: 20_000,
  })
}

test.describe('#112 R3-B 整页表单增量验收', () => {
  test('1440px 显示器在 200% 等效布局宽度下主操作可由键盘到达且页面不横滚', async ({ page }) => {
    test.setTimeout(120_000)
    // 1440px 显示器在浏览器 200% 缩放下约等于 720 CSS px 布局视口。
    await page.setViewportSize({ width: 720, height: 500 })

    for (const form of REPRESENTATIVE_FORMS) {
      await openRepresentativeForm(page, form)
      await expectNoPageOverflow(page, `${form.path} @ 720px`)

      const footer = page.getByRole('group', { name: '表单操作' })
      await expect(footer).toBeVisible()
      const enabledActions = footer.locator('button:not(:disabled)')
      const actionCount = await enabledActions.count()
      expect(actionCount, `${form.path} 至少应保留取消与主操作`).toBeGreaterThanOrEqual(2)

      await enabledActions.first().focus()
      for (let index = 1; index < actionCount; index++)
        await page.keyboard.press('Tab')
      await expect(enabledActions.last()).toBeFocused()
      await expect(enabledActions.last()).toBeInViewport()
    }
  })

  test('窄屏材料明细表只在自身容器横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/contract/material/form')
    await expect(page.getByRole('heading', { name: '新建 · 材料采购合同' })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByTestId('add-contract-line').click()

    const localScroll = await page.getByRole('table').evaluate((table) => {
      let candidate = table.parentElement
      while (candidate && candidate !== document.body) {
        const overflowX = getComputedStyle(candidate).overflowX
        if (/auto|scroll/.test(overflowX)) {
          return {
            client: candidate.clientWidth,
            scroll: candidate.scrollWidth,
          }
        }
        candidate = candidate.parentElement
      }
      return null
    })

    expect(localScroll, '材料明细表应具有独立横向滚动容器').not.toBeNull()
    expect(localScroll!.scroll).toBeGreaterThan(localScroll!.client)
    await expectNoPageOverflow(page, '/contract/material/form @ 390px')
  })
})
