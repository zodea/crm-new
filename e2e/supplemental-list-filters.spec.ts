import { expect, test } from '@playwright/test'
import { installMaterialProductionFixture } from './helpers/material-production-fixture'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
})

for (const width of [390, 1440]) {
  test(`${width}px 补充列表多选浮层可达且保持主视图`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))

    async function choose(label: string, count: number, options: string[]) {
      const trigger = page.getByRole('button', { name: `${label}，已选 ${count} 项`, exact: true })
      await expect(trigger).toBeVisible()
      await trigger.focus()
      await page.keyboard.press('Enter')
      const popover = page.getByRole('dialog', { name: new RegExp(`^${label}，已选`) })
      await expect(popover).toBeInViewport()
      await expect(popover.getByRole('button', { name: '全选', exact: true })).toBeVisible()
      for (const name of options)
        await popover.getByRole('checkbox', { name, exact: true }).check()
      await popover.getByRole('button', { name: '应用', exact: true }).click()
      const selected = page.getByRole('button', { name: `${label}，已选 ${count + options.length} 项`, exact: true })
      await expect(selected).toBeVisible()
      await selected.click()
      await page.keyboard.press('Escape')
      await expect(selected).toBeFocused()
      expect(await selected.evaluate(element => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeLessThanOrEqual(1)
      await selected.click()
      await popover.getByRole('button', { name: '清除', exact: true }).click()
      await expect(page.getByRole('button', { name: `${label}，已选 0 项`, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }

    await page.goto('/finance/invoice')
    await choose('筛选识别队列', 0, ['识别中', '建议通过'])

    await page.getByRole('button', { name: /^打开通知中心/ }).click()
    await choose('消息类型', 0, ['付款审批', '发票校对'])
    await page.getByRole('button', { name: '关闭消息中心', exact: true }).click()

    await page.goto('/finance/payment-management')
    await choose('付款状态', 1, ['已付清'])
    const paymentTable = page.getByTestId('payment-management-table')
    await expect(paymentTable.locator('.vxe-table.is--loading')).toHaveCount(0)
    await paymentTable.evaluate((element) => {
      element.setAttribute('data-retained-table', 'yes')
      let scheduled = false
      const observer = new MutationObserver(() => {
        if (scheduled || !element.querySelector('.vxe-table.is--loading'))
          return
        scheduled = true
        // VXE sets internal row-loading during microtasks; only a painted overlay can flash.
        requestAnimationFrame(() => {
          observer.disconnect()
          const overlay = element.querySelector<HTMLElement>('.vxe-loading--custom-wrapper')
          if (overlay && overlay.getClientRects().length && getComputedStyle(overlay).display !== 'none')
            element.setAttribute('data-refresh-covered', 'yes')
          element.setAttribute('data-refresh-painted', 'yes')
        })
      })
      observer.observe(element, { subtree: true, attributes: true, childList: true })
    })
    await page.getByRole('button', { name: '刷新付款管理', exact: true }).click()
    await expect(page.getByRole('button', { name: '刷新付款管理', exact: true })).toBeEnabled()
    await expect(paymentTable).toHaveAttribute('data-refresh-painted', 'yes')
    await expect(paymentTable).toHaveAttribute('data-retained-table', 'yes')
    await expect(paymentTable).not.toHaveAttribute('data-refresh-covered', 'yes')

    await installMaterialProductionFixture(page, { deliveryLines: [
      { materialName: 'E2E正式钢筋', spec: 'HRB400', unit: '吨', qty: 1, unitPrice: 100, amount: 100, amountSource: 'ocr', note: '' },
      { materialName: 'E2E正式木地板', spec: '600×600', unit: '㎡', qty: 0.5, unitPrice: 10, amount: 5, amountSource: 'ocr', note: '' },
    ] })
    await page.goto('/material/price?origin=real')
    await choose('按官方材料大类筛选', 0, ['1. 黑色及有色金属材料', '6. 装饰装修材料'])
    await expect(page.getByRole('heading', { name: '选择材料', exact: true })).toBeVisible()
    expect(await page.getByRole('option', { selected: true }).count()).toBe(1)

    await installQuantityProductionFixture(page, { totals: true })
    await page.getByRole('button', { name: '量差总表', exact: true }).click()
    await choose('分部', 0, ['装饰'])
    await choose('工种', 0, ['泥水工'])
    await expect(page.getByRole('combobox', { name: '对比口径', exact: true })).toHaveText(/现场量/)
    expect(errors).toEqual([])
  })
}
