import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

interface SupplierExportWrite {
  path: string
  bytes: number[]
  closed: boolean
}

interface SupplierExportState {
  writes: SupplierExportWrite[]
  pickerCalls: number
}

type SupplierExportWindow = Window & {
  __supplierExportTest: SupplierExportState
}

async function installDirectoryPicker(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as SupplierExportWindow
    testWindow.__supplierExportTest = { writes: [], pickerCalls: 0 }
    const createdFiles = new Set<string>()

    function directoryHandle(path: string[]) {
      return {
        name: path.at(-1) ?? 'E2E 分供方导出目录',
        async getDirectoryHandle(name: string) {
          return directoryHandle([...path, name])
        },
        async getFileHandle(name: string, options?: { create?: boolean }) {
          const fullPath = [...path, name].join('/')
          if (!options?.create) {
            if (!createdFiles.has(fullPath))
              throw Object.assign(new Error('文件不存在'), { name: 'NotFoundError' })
            return {
              async createWritable() {
                throw new Error('探测句柄不应写入')
              },
            }
          }

          createdFiles.add(fullPath)
          const record: SupplierExportWrite = { path: fullPath, bytes: [], closed: false }
          return {
            async createWritable() {
              return {
                async write(data: Uint8Array) {
                  record.bytes = Array.from(data)
                  testWindow.__supplierExportTest.writes.push(record)
                },
                async close() {
                  record.closed = true
                },
              }
            },
          }
        },
      }
    }

    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        testWindow.__supplierExportTest.pickerCalls += 1
        return directoryHandle([])
      },
    })
  })
}

function workbookRows(bytes: Uint8Array, sheetName: string): Record<string, unknown>[] {
  const workbook = XLSX.read(bytes)
  expect(workbook.SheetNames).toContain(sheetName)
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]!)
}

test('分供方单文件导出：当前筛选行生成真实 xlsx 并走浏览器下载降级', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined,
    })
  })

  await page.goto('/base/supplier')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('搜索公司名、税号、简称…').fill('广州市大板东')
  await expect(page.getByText('当前 1 家')).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出台账', exact: true }).click(),
  ])

  expect(download.suggestedFilename()).toMatch(/^分供方台账_\d{4}-\d{2}-\d{2}\.xlsx$/)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const rows = workbookRows(await readFile(downloadPath!), '分供方台账')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    '公司全称': '广州市大板东建材有限公司',
    '简称/别名': '大板东',
    '分供方类别': '材料供应商',
    '资料状态': '合格',
    '税号': '91440101MA5CBX1234',
  })

  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已导出到 浏览器下载 文件夹', { exact: true })).toBeVisible()
  expect(pageErrors, '分供方单文件导出不应产生客户端运行错误').toEqual([])
})

test('分供方分类导出：按类别/资料状态真实写出 10 个逐户 xlsx', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await installDirectoryPicker(page)

  await page.goto('/base/supplier')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '分类导出', exact: true }).click()

  await expect(page).toHaveURL(/\/export\/config\/[^/]+$/)
  await expect(page.getByText('分供方资料 · 10 个文件', { exact: true })).toBeVisible()
  await expect(page.getByLabel('一级目录字段')).toHaveValue('supplierCategory')
  await expect(page.getByLabel('二级目录字段')).toHaveValue('credentialStatus')
  await expect(page.getByRole('status')).toHaveText('材料供应商/合格/广州市大板东建材有限公司.xlsx')

  await page.getByRole('button', { name: '开始导出' }).click()
  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已导出到 E2E 分供方导出目录 文件夹', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/base\/supplier$/)

  const state = await page.evaluate(() => (window as SupplierExportWindow).__supplierExportTest)
  const expectedFiles = [
    ['材料供应商/合格/广州市大板东建材有限公司.xlsx', '广州市大板东建材有限公司', '材料供应商', '合格'],
    ['材料供应商/资料缺失/花城珠江电线电缆有限公司.xlsx', '花城珠江电线电缆有限公司', '材料供应商', '资料缺失'],
    ['材料供应商/合格/汇丰水泥制品有限公司.xlsx', '汇丰水泥制品有限公司', '材料供应商', '合格'],
    ['材料供应商/资料缺失/穗建五金机电经营部.xlsx', '穗建五金机电经营部', '材料供应商', '资料缺失'],
    ['专业分包商/资料缺失/鸿运建筑防水工程有限公司.xlsx', '鸿运建筑防水工程有限公司', '专业分包商', '资料缺失'],
    ['劳务分包商/合格/陈家泥水班组.xlsx', '陈家泥水班组', '劳务分包商', '合格'],
    ['材料供应商/合格/广东宏宇陶瓷有限公司.xlsx', '广东宏宇陶瓷有限公司', '材料供应商', '合格'],
    ['专业分包商/资料缺失/佛山华铝装饰工程有限公司.xlsx', '佛山华铝装饰工程有限公司', '专业分包商', '资料缺失'],
    ['专业分包商/合格/广州赛雄脚手架工程有限公司.xlsx', '广州赛雄脚手架工程有限公司', '专业分包商', '合格'],
    ['专业分包商/资料缺失/恒安机电安装工程有限公司.xlsx', '恒安机电安装工程有限公司', '专业分包商', '资料缺失'],
  ] as const

  expect(state.pickerCalls).toBe(1)
  expect(state.writes).toHaveLength(10)
  expect(state.writes.every(write => write.closed)).toBe(true)
  expect(state.writes.map(write => write.path)).toEqual(expectedFiles.map(([path]) => path))

  for (const [index, [, name, category, status]] of expectedFiles.entries()) {
    const rows = workbookRows(new Uint8Array(state.writes[index]!.bytes), '分供方')
    expect(rows, `${name} 应仅写入自己的逐户工作簿`).toEqual([
      expect.objectContaining({
        公司全称: name,
        分供方类别: category,
        资料状态: status,
      }),
    ])
  }
  expect(pageErrors, '分供方分类导出不应产生客户端运行错误').toEqual([])
})
