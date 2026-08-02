import { expect, test } from '@playwright/test'

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

async function openTemplateForm(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '户型模板', exact: true }).click()
  await expect(page).toHaveURL(/\/subcontract\/quantity\/template\?/)
  const form = page.getByRole('main').getByTestId('quantity-template-form')
  await expect(form).toBeVisible()
  await expect(form.getByRole('combobox', { name: '当前户型模板' })).toHaveValue('qty_tpl_a')
  return form
}

test.describe('Issue #103 Slice 3：户型模板活链接与三量', () => {
  test('编辑正式模板、计算现场量，并保护非法未保存草稿', async ({ page }) => {
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    let form = await openTemplateForm(page)

    await form.getByLabel('户型名称 *').fill('A户型（现场修订）')
    const wallItem = form.getByRole('combobox', { name: /分项 .*墙砖铺贴/ }).first()
    const wallRow = wallItem.locator('xpath=ancestor::tr')
    await wallRow.getByRole('combobox', { name: '录入来源' }).selectOption('field')
    const formula = await editFieldFormula(wallRow)
    await formula.fill('客厅（2＋3）×4')
    await formula.press('Enter')
    await expect(wallRow).toContainText('20')

    await form.getByRole('button', { name: '保存模板' }).click()
    await expect(form.getByText('已同步正式版本')).toBeVisible()
    await expect(page.getByText('户型模板已保存')).toBeVisible()
    await form.getByLabel('户型名称 *').fill('不应被旧撤回丢掉的草稿')
    await page.getByRole('button', { name: '撤回', exact: true }).click()
    const undoDiscard = page.getByRole('dialog', { name: '放弃未保存修改' })
    await expect(undoDiscard).toBeVisible()
    await undoDiscard.getByRole('button', { name: '取消' }).click()
    await expect(form.getByLabel('户型名称 *')).toHaveValue('不应被旧撤回丢掉的草稿')
    await expect(page.getByText('已取消撤回，当前内容保持不变')).toBeVisible()
    await form.getByRole('button', { name: '返回工程量矩阵' }).click()
    await page.getByRole('dialog', { name: '放弃未保存修改' }).getByRole('button', { name: '放弃修改' }).click()
    await expect(page).toHaveURL(/\/subcontract\/quantity(?:\?|$)/)

    form = await openTemplateForm(page)
    await expect(form.getByLabel('户型名称 *')).toHaveValue('A户型（现场修订）')
    const savedWallRow = form.getByRole('combobox', { name: /分项 .*墙砖铺贴/ }).first().locator('xpath=ancestor::tr')
    await expect(savedWallRow).toContainText('20')
    const savedFormula = await editFieldFormula(savedWallRow)
    await expect(savedFormula).toHaveValue('客厅（2＋3）×4')

    await savedFormula.fill('2÷0')
    await expect(savedWallRow.getByRole('alert')).toContainText('不能除以 0')
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

  test('借用模板形成新快照，并在无 BOQ 时随模板建立手工分项', async ({ page }) => {
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    const form = await openTemplateForm(page)

    await form.getByRole('button', { name: '借用当前模板新建' }).click()
    await form.getByLabel('户型编码 *').fill('C')
    await form.getByLabel('户型名称 *').fill('C户型')
    await form.getByRole('button', { name: '新增手工分项' }).click()
    await form.getByRole('textbox', { name: '新分项编码' }).fill('putty_manual')
    await form.getByRole('textbox', { name: '新分项名称' }).fill('第一遍腻子')
    await form.getByRole('textbox', { name: '新分项工种' }).fill('油漆工')
    const manualRow = form.getByRole('combobox', { name: /分项 .*第一遍腻子/ }).locator('xpath=ancestor::tr')
    await manualRow.getByRole('combobox', { name: '录入来源' }).selectOption('field')
    const manualFormula = await editFieldFormula(manualRow)
    await manualFormula.fill('整户：2×5')
    await manualFormula.press('Enter')
    await expect(manualRow).toContainText('10')

    await form.getByRole('button', { name: '保存模板' }).click()
    await expect(form.getByRole('combobox', { name: '当前户型模板' })).not.toHaveValue('')
    await expect(form.getByText('一次性借用快照')).toBeVisible()
    await expect(form.getByText('已同步正式版本')).toBeVisible()
    await expect(form.getByRole('combobox', { name: /分项 .*第一遍腻子/ })).toBeVisible()
  })

  test('390px 独立表单不撑宽页面，三量明细仅自身横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    const form = await openTemplateForm(page)

    await expect(page.getByRole('dialog', { name: '户型模板与三量' })).toHaveCount(0)
    await documentDoesNotOverflow(page)

    const tableScroller = form.locator('.overflow-x-auto').last()
    const metrics = await tableScroller.evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }))
    expect(metrics.scroll).toBeGreaterThan(metrics.client)
    expect(metrics.overflowX).toMatch(/auto|scroll/)
  })
})
