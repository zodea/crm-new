import { expect, test } from '@playwright/test'

async function openTemplateDialog(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '户型模板', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '户型模板与三量' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: '当前户型模板' })).toHaveValue('qty_tpl_a')
  return dialog
}

test.describe('Issue #103 Slice 3：户型模板活链接与三量', () => {
  test('编辑正式模板、计算现场量，并保护非法未保存草稿', async ({ page }) => {
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    let dialog = await openTemplateDialog(page)

    await dialog.getByLabel('户型名称 *').fill('A户型（现场修订）')
    const wallItem = dialog.getByRole('combobox', { name: /分项 .*墙砖铺贴/ }).first()
    const wallRow = wallItem.locator('xpath=ancestor::tr')
    const formula = wallRow.getByRole('textbox', { name: '现场复核算式' })
    await formula.fill('客厅（2＋3）×4')
    await expect(wallRow).toContainText('20')

    await dialog.getByRole('button', { name: '保存模板' }).click()
    await expect(dialog.getByText('已同步正式版本')).toBeVisible()
    await expect(page.getByText('户型模板已保存')).toBeVisible()
    await dialog.getByLabel('户型名称 *').fill('不应被旧撤回丢掉的草稿')
    await page.getByRole('button', { name: '撤回', exact: true }).click()
    const undoDiscard = page.getByRole('dialog', { name: '放弃未保存修改' })
    await expect(undoDiscard).toBeVisible()
    await undoDiscard.getByRole('button', { name: '取消' }).click()
    await expect(dialog.getByLabel('户型名称 *')).toHaveValue('不应被旧撤回丢掉的草稿')
    await expect(page.getByText('已取消撤回，当前内容保持不变')).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await page.getByRole('dialog', { name: '放弃未保存修改' }).getByRole('button', { name: '放弃修改' }).click()
    await expect(dialog).toHaveCount(0)

    dialog = await openTemplateDialog(page)
    await expect(dialog.getByLabel('户型名称 *')).toHaveValue('A户型（现场修订）')
    const savedWallRow = dialog.getByRole('combobox', { name: /分项 .*墙砖铺贴/ }).first().locator('xpath=ancestor::tr')
    await expect(savedWallRow.getByRole('textbox', { name: '现场复核算式' })).toHaveValue('客厅（2＋3）×4')

    await savedWallRow.getByRole('textbox', { name: '现场复核算式' }).fill('2÷0')
    await expect(savedWallRow.getByRole('alert')).toContainText('不能除以 0')
    await dialog.getByRole('button', { name: '保存模板' }).click()
    await expect(page.getByText(/现场量算式无效.*不能除以 0/)).toBeVisible()

    await dialog.getByRole('button', { name: '关闭' }).click()
    const discard = page.getByRole('dialog', { name: '放弃未保存修改' })
    await expect(discard).toBeVisible()
    await discard.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await page.getByRole('dialog', { name: '放弃未保存修改' }).getByRole('button', { name: '放弃修改' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('借用模板形成新快照，并在无 BOQ 时随模板建立手工分项', async ({ page }) => {
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    const dialog = await openTemplateDialog(page)

    await dialog.getByRole('button', { name: '借用当前模板新建' }).click()
    await dialog.getByLabel('户型编码 *').fill('C')
    await dialog.getByLabel('户型名称 *').fill('C户型')
    await dialog.getByRole('button', { name: '新增手工分项' }).click()
    await dialog.getByRole('textbox', { name: '新分项编码' }).fill('putty_manual')
    await dialog.getByRole('textbox', { name: '新分项名称' }).fill('第一遍腻子')
    await dialog.getByRole('textbox', { name: '新分项工种' }).fill('油漆工')
    const manualRow = dialog.getByRole('combobox', { name: /分项 .*第一遍腻子/ }).locator('xpath=ancestor::tr')
    await manualRow.getByRole('textbox', { name: '现场复核算式' }).fill('整户：2×5')
    await expect(manualRow).toContainText('10')

    await dialog.getByRole('button', { name: '保存模板' }).click()
    await expect(dialog.getByRole('combobox', { name: '当前户型模板' })).not.toHaveValue('')
    await expect(dialog.getByText('一次性借用快照')).toBeVisible()
    await expect(dialog.getByText('已同步正式版本')).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: /分项 .*第一遍腻子/ })).toBeVisible()
  })
})
