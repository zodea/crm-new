import { expect, test } from '@playwright/test'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

const viewports = [390, 768, 1024, 1280, 1440]
const revisions = [
  { label: '全角算式', name: 'A户型（现场修订）', formula: '客厅（2＋3）×4', expected: '20', unsavedName: '全角算式未保存草稿', invalidFormula: '2÷0', error: '不能除以 0' },
  { label: '小数算式', name: 'A户型（小数修订）', formula: '客厅：(2.5+3.5)*4', expected: '24', unsavedName: '小数算式未保存草稿', invalidFormula: '3/0', error: '不能除以 0' },
]
const copies = [
  { label: '腻子面积', code: 'C', name: 'C户型', itemCode: 'putty_manual', itemName: '第一遍腻子', trade: '油漆工', formula: '整户：2×5', expected: '10' },
  { label: '涂料面积', code: 'D', name: 'D户型', itemCode: 'paint_manual', itemName: '第二遍涂料', trade: '油漆工', formula: '整户：3×3', expected: '9' },
]

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

// 现场复核单元格静态态只显示计算结果，进入编辑态才暴露算式输入框。
async function editFieldFormula(row: import('@playwright/test').Locator) {
  const editor = row.getByRole('textbox', { name: '现场复核算式' })
  if (!await editor.isVisible())
    await row.getByRole('button', { name: /现场复核量.*点击编辑算式/ }).click()
  await expect(editor).toBeVisible()
  return editor
}

async function openTemplateForm(page: import('@playwright/test').Page, templateId: string) {
  await page.getByRole('button', { name: '户型模板', exact: true }).click()
  await expect(page).toHaveURL(/\/subcontract\/quantity\/template\?/)
  const form = page.getByRole('main').getByTestId('quantity-template-form')
  await expect(form).toBeVisible()
  await expect(form.getByRole('combobox', { name: '当前户型模板' })).toHaveValue(templateId)
  return form
}

test.describe('Issue #103 Slice 3：户型模板活链接与三量', () => {
  for (const input of revisions) {
    test(`编辑正式模板、计算现场量，并保护非法未保存草稿：${input.label}`, async ({ page }) => {
      const f = await installQuantityProductionFixture(page)
      let form = await openTemplateForm(page, f.templateId)

      await form.getByLabel('户型名称 *').fill(input.name)
      const wallItem = form.getByRole('combobox', { name: /分项 .*墙砖铺贴/ })
      const wallRow = wallItem.locator('xpath=ancestor::tr')
      await wallRow.getByRole('combobox', { name: '录入来源' }).selectOption('field')
      const formula = await editFieldFormula(wallRow)
      await formula.fill(input.formula)
      await formula.press('Enter')
      await expect(wallRow).toContainText(input.expected)

      await form.getByRole('button', { name: '保存模板' }).click()
      await expect(form.getByText('已同步当前读取版本')).toBeVisible()
      await expect(page.getByText('户型模板已更新', { exact: true })).toBeVisible()
      await form.getByLabel('户型名称 *').fill(input.unsavedName)
      await page.getByRole('button', { name: '撤回', exact: true }).click()
      const undoDiscard = page.getByRole('dialog', { name: '放弃未保存修改' })
      await expect(undoDiscard).toBeVisible()
      await undoDiscard.getByRole('button', { name: '取消' }).click()
      await expect(form.getByLabel('户型名称 *')).toHaveValue(input.unsavedName)
      await expect(page.getByText('已取消撤回，当前内容保持不变')).toBeVisible()
      await form.getByRole('button', { name: '返回工程量矩阵' }).click()
      await page.getByRole('dialog', { name: '放弃未保存修改' }).getByRole('button', { name: '放弃修改' }).click()
      await expect(page).toHaveURL(/\/subcontract\/quantity(?:\?|$)/)

      form = await openTemplateForm(page, f.templateId)
      await expect(form.getByLabel('户型名称 *')).toHaveValue(input.name)
      const savedWallRow = form.getByRole('combobox', { name: /分项 .*墙砖铺贴/ }).locator('xpath=ancestor::tr')
      await expect(savedWallRow).toContainText(input.expected)
      await savedWallRow.getByRole('combobox', { name: '录入来源' }).selectOption('field')
      const savedFormula = await editFieldFormula(savedWallRow)
      await expect(savedFormula).toHaveValue(input.formula)

      await savedFormula.fill(input.invalidFormula)
      await expect(savedWallRow.getByRole('alert')).toContainText(input.error)
      await form.getByRole('button', { name: '保存模板' }).click()
      await expect(page.getByText(/现场量算式无效.*不能除以 0/)).toBeVisible()

      await form.getByRole('button', { name: '返回工程量矩阵' }).click()
      const discard = page.getByRole('dialog', { name: '放弃未保存修改' })
      await expect(discard).toBeVisible()
      await discard.getByRole('button', { name: '取消' }).click()
      await expect(form).toBeVisible()
      await form.getByRole('button', { name: '返回工程量矩阵' }).click()
      await page.getByRole('dialog', { name: '放弃未保存修改' }).getByRole('button', { name: '放弃修改' }).click()
      await expect(page).toHaveURL(/\/subcontract\/quantity(?:\?|$)/)
    })
  }
  for (const input of copies) {
    test(`借用模板形成新快照，并在无 BOQ 时随模板建立手工分项：${input.label}`, async ({ page }) => {
      const f = await installQuantityProductionFixture(page)
      const form = await openTemplateForm(page, f.templateId)

      await form.getByRole('button', { name: '借用当前模板新建' }).click()
      await form.getByLabel('户型编码 *').fill(input.code)
      await form.getByLabel('户型名称 *').fill(input.name)
      await form.getByRole('button', { name: '新增手工分项' }).click()
      await form.getByRole('textbox', { name: '新分项编码' }).fill(input.itemCode)
      await form.getByRole('textbox', { name: '新分项名称' }).fill(input.itemName)
      await form.getByRole('textbox', { name: '新分项工种' }).fill(input.trade)
      const manualRow = form.getByRole('combobox', { name: new RegExp(`分项 .*${input.itemName}`) }).locator('xpath=ancestor::tr')
      await manualRow.getByRole('combobox', { name: '录入来源' }).selectOption('field')
      const manualFormula = await editFieldFormula(manualRow)
      await manualFormula.fill(input.formula)
      await manualFormula.press('Enter')
      await expect(manualRow).toContainText(input.expected)

      await form.getByRole('button', { name: '保存模板' }).click()
      await expect(form.getByRole('combobox', { name: '当前户型模板' })).not.toHaveValue('')
      await expect(form.getByText('一次性借用快照')).toBeVisible()
      await expect(form.getByText('已同步当前读取版本')).toBeVisible()
      await expect(form.getByRole('combobox', { name: new RegExp(`分项 .*${input.itemName}`) })).toBeVisible()
    })
  }
  for (const width of viewports) {
    test(`${width}px 独立表单不撑宽页面，三量明细仅自身横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
      const f = await installQuantityProductionFixture(page)
      const form = await openTemplateForm(page, f.templateId)

      await expect(page.getByRole('dialog', { name: '户型模板与三量' })).toHaveCount(0)
      await documentDoesNotOverflow(page)

      const tableScroller = form.locator('.overflow-x-auto').last()
      const metrics = await tableScroller.evaluate(element => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      }))
      if (width === 390)
        expect(metrics.scroll).toBeGreaterThan(metrics.client)
      else
        expect(metrics.scroll).toBeGreaterThanOrEqual(metrics.client)
      expect(metrics.overflowX).toMatch(/auto|scroll/)
    })
  }
})
