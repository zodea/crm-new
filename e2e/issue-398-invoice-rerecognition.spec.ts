import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectInViewport, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

/** 读当前库内值（store 每次写后都从库重载，与库一致）。 */
function storedInvoice(page: Page) {
  return page.evaluate(() => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    const invoice = app.config.globalProperties.$pinia._s.get('invoice').list.find((row: { fileName: string }) => row.fileName === 'audit-398.png')
    return { number: invoice.invoiceNumber, total: invoice.totalAmount, seller: invoice.seller, review: invoice.reviewStatus }
  })
}

// 合成票面：文字位置与下方 OCR 版面块坐标一致（1000×700 像素），便于目测框是否对位。
const OCR_PAGE = { width: 1000, height: 700 }
function ocrBlocks(markdown: string) {
  const lines = markdown.split('\n')
  return [
    { block_label: 'text', block_bbox: [560, 40, 960, 120], block_content: lines.slice(1, 3).join('\n') },
    { block_label: 'text', block_bbox: [40, 180, 960, 300], block_content: lines.slice(3, 5).join('\n') },
    { block_label: 'text', block_bbox: [40, 520, 960, 640], block_content: lines.slice(5).join('\n') },
  ]
}

async function syntheticInvoicePng(page: Page) {
  const dataUrl = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#333'
    context.font = '28px sans-serif'
    context.fillText('电子发票（普通发票）', 340, 30)
    context.font = '22px sans-serif'
    const rows: Array<[string, number, number]> = [
      ['发票号码：26442000000000000398', 570, 70],
      ['开票日期：2026年09月05日', 570, 105],
      ['购买方名称：瑞航建设', 50, 220],
      ['销售方名称：审计回归供应商', 50, 270],
      ['合计 ¥100.00 ¥13.00', 50, 560],
      ['价税合计（小写）¥113.00', 50, 615],
    ]
    for (const [text, x, y] of rows)
      context.fillText(text, x, y)
    context.strokeStyle = '#999'
    context.strokeRect(20, 160, 960, 500)
    return canvas.toDataURL('image/png')
  }, OCR_PAGE)
  return Buffer.from(dataUrl.split(',')[1]!, 'base64')
}

/** 原图上某块的框（data-fields 为落在该块的变动字段 key，以空格分隔）。 */
function regionBox(page: Page, fields: string) {
  return page.locator(`[data-testid="invoice-region-box"][data-fields="${fields}"]`)
}

// 用户 2026-10-13 确认：重新识别结果先作草稿不写库，变动字段高亮，保存/确认须二次确认列出变动，离开按离开保护处理。
test('工作台与编辑页重新识别先作草稿：高亮变动、保存二次确认、取消不写库，1440 与 390 视口可用键盘操作', async ({ page }) => {
  let attempt = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/ocr/recognize', (route) => {
    attempt++
    const markdown = `电子发票（普通发票）
发票号码：${26442000000000000397n + BigInt(attempt)}
开票日期：2026年09月05日
购买方名称：瑞航建设
销售方名称：审计回归供应商
合计 ¥${100 * attempt}.00 ¥${13 * attempt}.00
价税合计（小写）¥${113 * attempt}.00`
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
      jobId: `audit-${attempt}`,
      pages: [{ pageIndex: 0, markdown, prunedResult: OCR_PAGE, layoutRegions: ocrBlocks(markdown) }],
      markdownPages: [markdown],
      dataInfo: { numPages: 1 },
    }) })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/finance/invoice')
  const invoicePng = await syntheticInvoicePng(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传发票', exact: true }).click()
  await (await chooser).setFiles({ name: 'audit-398.png', mimeType: 'image/png', buffer: invoicePng })
  const number = page.getByLabel('单据编号', { exact: true })
  await expect(number).toHaveValue('26442000000000000398')
  // 首次识别直接写入，没有可对照的原值，不显示原图比对框。
  await expect(page.getByTestId('invoice-region-viewer')).toHaveCount(0)

  // 工作台：人工更正即时落库后重新识别，结果只进表单。
  await page.getByLabel('供应商', { exact: true }).fill('人工更正供应商')
  await page.getByLabel('供应商', { exact: true }).blur()
  await page.getByRole('button', { name: '重新识别', exact: true }).click()
  await expect(number).toHaveValue('26442000000000000399')
  const workspaceChanges = page.getByTestId('invoice-recognition-changes')
  await expect(workspaceChanges).toContainText('重新识别结果未保存：4 项与识别前不同')
  await expect(workspaceChanges).toContainText('单据编号：26442000000000000398 → 26442000000000000399')
  await expect(workspaceChanges).toContainText('供应商：人工更正供应商 → （空）')
  await expect(workspaceChanges).toContainText('价税合计：113 → 226')
  expect(await storedInvoice(page)).toMatchObject({ number: '26442000000000000398', total: 113, seller: '人工更正供应商' })
  await expect(number).toHaveAccessibleDescription(/识别变动.*识别前：26442000000000000398.*原图已框出/)

  // 原图比对（用户 2026-10-14）：变动字段按块框出并带字段名；识别为空的供应商定位不到，如实说明。
  const viewer = page.getByTestId('invoice-region-viewer')
  await expect(viewer.getByTestId('invoice-region-box')).toHaveCount(2)
  await expect(regionBox(page, 'invoiceNumber')).toContainText('单据编号')
  await expect(regionBox(page, 'totalAmount taxAmount')).toContainText('价税合计、税额')
  await expect(page.getByTestId('invoice-region-legend')).toContainText('原图未定位：供应商')
  await expect(page.getByLabel('供应商', { exact: true })).toHaveAccessibleDescription(/原图未定位/)
  const changeItems = workspaceChanges.getByTestId('invoice-recognition-change-item')
  await expect(changeItems.filter({ hasText: '供应商' })).toContainText('原图未定位')
  // 聚焦字段：对应框强调并滚进原图视野；键盘 Tab 到变动条目同样切换强调。
  await page.getByLabel('价税合计', { exact: true }).focus()
  await expect(regionBox(page, 'totalAmount taxAmount')).toHaveAttribute('data-active', 'true')
  await expect(regionBox(page, 'invoiceNumber')).toHaveAttribute('data-active', 'false')
  await expectInViewport(regionBox(page, 'totalAmount taxAmount'), '工作台强调框 @ 1440px')
  await page.screenshot({ path: '.tmp/invoice-image/workspace-1440.png' })
  await changeItems.first().focus()
  await expect(regionBox(page, 'invoiceNumber')).toHaveAttribute('data-active', 'true')
  await page.keyboard.press('Tab')
  await expect(changeItems.nth(1)).toBeFocused()
  await expect(viewer.locator('[data-testid="invoice-region-box"][data-active="true"]')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(changeItems.nth(2)).toBeFocused()
  await expect(regionBox(page, 'totalAmount taxAmount')).toHaveAttribute('data-active', 'true')
  // 缩放与旋转：框由同一份坐标换算，仍框住同一块。
  await viewer.getByRole('button', { name: '放大原图' }).click()
  await viewer.getByRole('button', { name: '原图向右旋转' }).click()
  await expectInViewport(regionBox(page, 'totalAmount taxAmount'), '工作台旋转后强调框 @ 1440px')
  await viewer.getByRole('button', { name: '原图向左旋转' }).click()
  await viewer.getByRole('button', { name: '恢复 100% 缩放' }).click()
  // 390：切到“原件”面板仍能看到最近聚焦字段的强调框。
  await page.setViewportSize({ width: 390, height: 900 })
  await page.getByRole('tab', { name: '原件', exact: true }).click()
  await expect(regionBox(page, 'totalAmount taxAmount')).toHaveAttribute('data-active', 'true')
  await expectInViewport(regionBox(page, 'totalAmount taxAmount'), '工作台强调框 @ 390px')
  await expectNoPageOverflow(page, '工作台原图比对 @ 390px')
  await page.setViewportSize({ width: 1440, height: 900 })

  // 草稿上再手改：角标改为“已人工修改”，仍不写库。
  const total = page.getByLabel('价税合计', { exact: true })
  await total.fill('230')
  await total.press('Tab')
  await expect(total).toHaveAccessibleDescription(/已人工修改/)
  expect((await storedInvoice(page)).total).toBe(113)

  // 1440 与 390：高亮可见，确认动作先弹二次确认，焦点落取消，Esc 取消不写库且草稿保留。
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    if (width === 390)
      await page.getByRole('tab', { name: '校对', exact: true }).click()
    await workspaceChanges.scrollIntoViewIfNeeded()
    await expectInViewport(workspaceChanges, `工作台识别草稿提醒 @ ${width}px`)
    await number.scrollIntoViewIfNeeded()
    await expectInViewport(page.getByTestId('invoice-recognition-field-mark').first(), `工作台字段角标 @ ${width}px`)
    // 字段级“✓确认”同名，限定到底栏主按钮
    const confirmButton = page.locator('button.btn-accent', { hasText: '确认' })
    await confirmButton.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('保存重新识别结果')
    await expect(dialog).toContainText('单据编号：26442000000000000398 → 26442000000000000399')
    await expect(dialog).toContainText('价税合计：113 → 230')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await expectInViewport(dialog.getByRole('button', { name: '确认保存' }), `工作台保存确认 @ ${width}px`)
    await expectNoPageOverflow(page, `工作台识别草稿 @ ${width}px`)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(confirmButton).toBeFocused()
    await expect(number).toHaveValue('26442000000000000399')
    expect(await storedInvoice(page)).toMatchObject({ number: '26442000000000000398', total: 113 })
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  // 离开保护：有草稿时离开须确认放弃，取消留在原页。
  await page.evaluate(() => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    void app.config.globalProperties.$router.push('/finance/ledger')
  })
  await expect(page.getByRole('dialog')).toContainText('放弃识别结果')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/finance\/invoice$/)
  await expect(number).toHaveValue('26442000000000000399')

  // 确认保存：识别结果与人工修改写库，回到待校对。
  await page.getByRole('button', { name: '保存识别结果', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认保存' }).click()
  await expect(workspaceChanges).toBeHidden()
  await expect(page.getByTestId('invoice-recognition-field-mark')).toHaveCount(0)
  expect(await storedInvoice(page)).toEqual({ number: '26442000000000000399', total: 230, seller: '', review: 'unreviewed' })

  // 用本应用现有路由打开编辑页，保留上传会话中的原文件。
  await page.evaluate(async () => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('invoice')
    const invoice = store.list.find((row: { fileName: string }) => row.fileName === 'audit-398.png')
    await app.config.globalProperties.$router.push(`/finance/invoice/${invoice.id}`)
  })
  // 编辑页：未保存的人工修改也进入对比，识别结果只填进表单。
  await page.getByLabel('供应商', { exact: true }).fill('编辑页人工供应商')
  await page.getByRole('button', { name: '重新识别', exact: true }).click()
  await expect(number).toHaveValue('26442000000000000400')
  await expect(page.getByLabel('价税合计', { exact: true })).toHaveValue('339')
  const editChanges = page.getByTestId('invoice-recognition-changes')
  await expect(editChanges).toContainText('重新识别结果未保存：4 项与识别前不同')
  await expect(editChanges).toContainText('供应商：编辑页人工供应商 → （空）')
  await expect(number).toHaveAccessibleDescription(/识别前：26442000000000000399/)
  expect(await storedInvoice(page)).toMatchObject({ number: '26442000000000000399', total: 230 })
  // 编辑页左栏改为原文件并框出变动字段；聚焦字段强调对应框。
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByTestId('invoice-region-box')).toHaveCount(2)
    await page.getByLabel('税额', { exact: true }).focus()
    await expect(regionBox(page, 'totalAmount taxAmount')).toHaveAttribute('data-active', 'true')
    await page.getByTestId('invoice-region-viewer').scrollIntoViewIfNeeded()
    await expectInViewport(regionBox(page, 'totalAmount taxAmount'), `编辑页强调框 @ ${width}px`)
    if (width === 1440)
      await page.screenshot({ path: '.tmp/invoice-image/edit-1440.png' })
    await page.getByLabel('单据编号', { exact: true }).focus()
    await expect(regionBox(page, 'invoiceNumber')).toHaveAttribute('data-active', 'true')
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await number.scrollIntoViewIfNeeded()
    await expectInViewport(page.getByTestId('invoice-recognition-field-mark').first(), `编辑页字段角标 @ ${width}px`)
    const saveButton = page.getByRole('button', { name: '保存', exact: true })
    await saveButton.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('价税合计：230 → 339')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await expectInViewport(dialog.getByRole('button', { name: '确认保存' }), `编辑页保存确认 @ ${width}px`)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(saveButton).toBeFocused()
    expect(await storedInvoice(page)).toMatchObject({ number: '26442000000000000399', total: 230 })
  }
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `发票重新识别草稿 @ ${width}px`)
  }
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认保存' }).click()
  await expect(page).toHaveURL(/\/finance\/ledger$/)
  expect(await storedInvoice(page)).toEqual({ number: '26442000000000000400', total: 339, seller: '', review: 'unreviewed' })
  expect(errors).toEqual([])
})
