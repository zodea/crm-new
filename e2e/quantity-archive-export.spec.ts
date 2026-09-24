import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

test('中央矩阵归档取消、确认及解除回读一致，分类导出保留目录和施工记录原值', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const fixture = await installQuantityProductionFixture(page, { totals: true })
  await page.getByRole('button', { name: '归档矩阵', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '归档工程量矩阵', exact: true })
  await expect(confirmation).toBeVisible()
  await page.keyboard.press('Escape')
  expect((await fixture.read('region')).data.matrixArchivedAt).toBeNull()
  await page.getByRole('button', { name: '归档矩阵', exact: true }).click()
  await confirmation.getByRole('button', { name: '确认归档', exact: true }).click()
  await expect.poll(async () => (await fixture.read('region')).data.matrixArchivedAt).not.toBeNull()
  await expect(page.getByRole('button', { name: '解除归档', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '解除归档', exact: true }).click()
  const unarchive = page.getByRole('dialog', { name: '解除矩阵归档', exact: true })
  await expect(unarchive).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('unarchive-confirm.png'), animations: 'disabled' })
  await unarchive.getByRole('button', { name: '解除归档', exact: true }).click()
  await expect.poll(async () => (await fixture.read('region')).data.matrixArchivedAt).toBeNull()

  await page.evaluate(() => {
    const state = { pickerCalls: 0, writes: [] as { path: string, bytes: number[], closed: boolean }[] }
    Object.assign(window, { quantityCategoryExportTest: state })
    const directory = (parts: string[]): unknown => ({
      name: parts.at(-1) ?? '合成工程量目录',
      getDirectoryHandle: async (name: string) => directory([...parts, name]),
      getFileHandle: async (name: string, options: { create: boolean }) => {
        if (!options.create)
          throw new DOMException('合成目录没有同名文件', 'NotFoundError')
        return {
          createWritable: async () => {
            const result = { path: [...parts, name].join('/'), bytes: [] as number[], closed: false }
            return {
              write: async (bytes: Uint8Array) => {
                result.bytes = Array.from(bytes)
                state.writes.push(result)
              },
              close: async () => { result.closed = true },
            }
          },
        }
      },
    })
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
      state.pickerCalls++
      return directory([])
    } })
  })
  await page.getByRole('button', { name: '分类导出', exact: true }).click()
  await expect(page).toHaveURL(/\/export\/config\/[^/]+$/)
  await expect(page.getByText('工程量施工记录 · 1 个文件', { exact: true })).toBeVisible()
  await expect(page.getByLabel('一级目录字段')).toHaveValue('buildingName')
  await expect(page.getByLabel('二级目录字段')).toHaveValue('trade')
  await expect(page.getByRole('status')).toContainText('1栋/泥水工/2层-201户.xlsx')
  await page.screenshot({ path: testInfo.outputPath('category-export.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '开始导出', exact: true }).click()
  await expect(page).toHaveURL(/\/subcontract\/quantity\?/)
  const state = await page.evaluate(() => (window as unknown as { quantityCategoryExportTest: { pickerCalls: number, writes: { path: string, bytes: number[], closed: boolean }[] } }).quantityCategoryExportTest)
  expect(state.pickerCalls).toBe(1)
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0]).toMatchObject({ path: '1栋/泥水工/2层-201户.xlsx', closed: true })
  const workbook = XLSX.read(new Uint8Array(state.writes[0]!.bytes))
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['施工记录']!)
  expect(rows).toHaveLength(2)
  expect(rows.map(row => row.工序阶段)).toEqual(expect.arrayContaining(['泥水完成', '共用分项复验']))
  expect(rows.every(row => row.完成日期 === '2026-08-01' && row.完成时执行责任 === '泥水A班' && row.验收照片数 === 1)).toBe(true)
})
