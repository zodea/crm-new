import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

interface ExportWriteRecord {
  name: string
  bytes: number[]
  closed: boolean
}

declare global {
  interface Window {
    __exportTestWrites: ExportWriteRecord[]
  }
}

test('KitUI 单文件导出：选择目录、写入文件且只显示一次成功反馈', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.addInitScript(() => {
    const testWindow = window
    testWindow.__exportTestWrites = []
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => ({
        name: 'E2E 导出目录',
        async getFileHandle(name: string, options?: { create?: boolean }) {
          // 与生产写盘契约一致：create:false 是防覆盖探测，不存在时抛 NotFoundError。
          if (!options?.create)
            throw Object.assign(new Error('文件不存在'), { name: 'NotFoundError' })
          const record: ExportWriteRecord = { name, bytes: [], closed: false }
          testWindow.__exportTestWrites.push(record)
          return {
            async createWritable() {
              return {
                async write(data: Uint8Array) {
                  await new Promise(resolve => setTimeout(resolve, 1000))
                  record.bytes = Array.from(data)
                },
                async close() {
                  record.closed = true
                },
              }
            },
          }
        },
      }),
    })
  })

  await page.goto('/dev/kit-ui')
  await page.getByRole('button', { name: '直接保存演示文件' }).click()

  const processToaster = page.locator('[data-sonner-toaster][data-y-position="bottom"]')
  const systemToaster = page.locator('[data-sonner-toaster][data-y-position="top"]')
  const processLoading = processToaster.getByText('正在写入导出文件…', { exact: true })
  await expect(processLoading).toBeVisible()

  const systemSuccess = systemToaster.getByText('已导出到 E2E 导出目录 文件夹', { exact: true })
  await expect(systemSuccess).toBeVisible()
  await expect(systemSuccess).toHaveCount(1)
  await expect(processToaster.getByText('已导出到 E2E 导出目录 文件夹', { exact: true })).toHaveCount(0)
  await expect(processLoading).toBeHidden()
  await expect(page.getByText('直接保存完成：E2E 导出目录', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.locator('[data-ripple], .ripple')).toHaveCount(0)

  const writes = await page.evaluate(() => window.__exportTestWrites)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    name: '瑞航CRM-导出演示.txt',
    closed: true,
  })
  expect(new TextDecoder().decode(new Uint8Array(writes[0]!.bytes))).toContain('瑞航 CRM 导出演示')
  expect(pageErrors, '导出完整旅程不应产生客户端运行错误').toEqual([])
})

test('KitUI 单文件导出：关闭目录选择器时静默取消', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.addInitScript(() => {
    const testWindow = window
    testWindow.__exportTestWrites = []
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        throw new DOMException('用户取消目录选择', 'AbortError')
      },
    })
  })

  await page.goto('/dev/kit-ui')
  await page.getByRole('button', { name: '直接保存演示文件' }).click()

  await expect(page.getByText('直接保存已取消（未写入文件）', { exact: true })).toBeVisible()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.locator('[data-ripple], .ripple')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__exportTestWrites)).toEqual([])
  expect(pageErrors, '取消目录选择不应产生客户端运行错误').toEqual([])
})

test('KitUI 单文件导出：目录选择器异常时只走 process error', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        throw new Error('目录权限不足')
      },
    })
  })

  await page.goto('/dev/kit-ui')
  await page.getByRole('button', { name: '直接保存演示文件' }).click()

  const processToaster = page.locator('[data-sonner-toaster][data-y-position="bottom"]')
  const systemToaster = page.locator('[data-sonner-toaster][data-y-position="top"]')
  await expect(processToaster.getByText('导出失败', { exact: true })).toBeVisible()
  await expect(processToaster.getByText('目录权限不足', { exact: true })).toBeVisible()
  await expect(systemToaster.getByText(/已导出到/)).toHaveCount(0)
  await expect(page.getByText('直接保存失败：目录权限不足', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.locator('[data-ripple], .ripple')).toHaveCount(0)
  expect(pageErrors, '目录选择器异常应由 KitUI 收口，不产生未处理错误').toEqual([])
})

test('KitUI 单文件导出：不支持目录访问 API 时如实降级到浏览器下载', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined,
    })
  })

  await page.goto('/dev/kit-ui')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '直接保存演示文件' }).click(),
  ])

  expect(download.suggestedFilename()).toBe('瑞航CRM-导出演示.txt')
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  await expect.poll(async () => await readFile(downloadPath!, 'utf8')).toContain('瑞航 CRM 导出演示')

  const systemToaster = page.locator('[data-sonner-toaster][data-y-position="top"]')
  await expect(systemToaster.getByText('已导出到 浏览器下载 文件夹', { exact: true })).toBeVisible()
  await expect(page.getByText('直接保存完成：浏览器下载', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.locator('[data-ripple], .ripple')).toHaveCount(0)
})
