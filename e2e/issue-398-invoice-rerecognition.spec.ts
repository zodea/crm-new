import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test('工作台与编辑页重新识别覆盖字段并逐项提醒变动，保存新字段，四档视口可操作', async ({ page }) => {
  let attempt = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/ocr/recognize', (route) => {
    attempt++
    const markdown = `电子发票（普通发票）
发票号码：${attempt === 1 ? '26442000000000000398' : '26442000000000000399'}
开票日期：2026年09月05日
购买方名称：瑞航建设
销售方名称：审计回归供应商
合计 ¥${attempt === 1 ? '100.00' : '200.00'} ¥${attempt === 1 ? '13.00' : '26.00'}
价税合计（小写）¥${attempt === 1 ? '113.00' : '226.00'}`
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
      jobId: `audit-${attempt}`,
      pages: [{ pageIndex: 0, markdown, prunedResult: {}, layoutRegions: [] }],
      markdownPages: [markdown],
      dataInfo: { numPages: 1 },
    }) })
  })
  await page.goto('/finance/invoice')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传发票', exact: true }).click()
  await (await chooser).setFiles({ name: 'audit-398.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByLabel('单据编号', { exact: true })).toHaveValue('26442000000000000398')

  // 工作台：人工更正即时落库后再重新识别，覆盖的字段逐项提醒。
  await page.getByLabel('供应商', { exact: true }).fill('人工更正供应商')
  await page.getByLabel('供应商', { exact: true }).blur()
  await page.getByRole('button', { name: '重新识别', exact: true }).click()
  await expect(page.getByLabel('单据编号', { exact: true })).toHaveValue('26442000000000000399')
  const workspaceChanges = page.getByTestId('invoice-recognition-changes')
  await expect(workspaceChanges).toContainText('单据编号：26442000000000000398 → 26442000000000000399')
  // 这段 OCR 文本识别不出供应商：人工更正被空的识别结果覆盖，正是需要提醒的情况。
  await expect(workspaceChanges).toContainText('供应商：人工更正供应商 → （空）')
  await expect(workspaceChanges).toContainText('价税合计：113 → 226')
  await page.screenshot({ path: 'test-results/invoice-rerecognition-workspace.png' })
  await page.getByRole('button', { name: '关闭识别变动提醒' }).click()
  await expect(workspaceChanges).toBeHidden()

  // 用本应用现有路由打开编辑页，保留上传会话中的原文件。
  await page.evaluate(async () => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('invoice')
    const invoice = store.list.find((row: { fileName: string }) => row.fileName === 'audit-398.png')
    await app.config.globalProperties.$router.push(`/finance/invoice/${invoice.id}`)
  })
  // 编辑页：未保存的人工修改也会被识别覆盖，提醒只列出与识别前不同的字段。
  await page.getByLabel('供应商', { exact: true }).fill('编辑页人工供应商')
  await page.getByRole('button', { name: '重新识别', exact: true }).click()
  await expect(page.getByLabel('单据编号', { exact: true })).toHaveValue('26442000000000000399')
  await expect(page.getByLabel('价税合计', { exact: true })).toHaveValue('226')
  const editChanges = page.getByTestId('invoice-recognition-changes')
  await expect(editChanges).toContainText('重新识别覆盖了 1 项与识别前不同的内容')
  await expect(editChanges).toContainText('供应商：编辑页人工供应商 → （空）')
  await page.screenshot({ path: 'test-results/invoice-rerecognition-edit.png' })
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoPageOverflow(page, `发票重新识别 @ ${width}px`)
  }
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/\/finance\/ledger$/)
  expect(await page.evaluate(() => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__
    const invoice = app.config.globalProperties.$pinia._s.get('invoice').list.find((row: { fileName: string }) => row.fileName === 'audit-398.png')
    return { number: invoice.invoiceNumber, total: invoice.totalAmount }
  })).toEqual({ number: '26442000000000000399', total: 226 })
  expect(errors).toEqual([])
})
