import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

interface ConfigExportWriteRecord {
  path: string
  bytes: number[]
  closed: boolean
}

interface ConfigExportTestState {
  writes: ConfigExportWriteRecord[]
  pickerCalls: number
  failWrites: number
  stepStates: string[][]
}

type ConfigExportTestWindow = Window & {
  __configExportTest: ConfigExportTestState
}

async function installDirectoryPicker(page: Page, failWrites = 0) {
  await page.addInitScript(({ initialFailWrites }) => {
    const testWindow = window as ConfigExportTestWindow
    testWindow.__configExportTest = {
      writes: [],
      pickerCalls: 0,
      failWrites: initialFailWrites,
      stepStates: [],
    }

    // 与生产写盘契约一致：create:false 探测不存在时抛 NotFoundError，
    // create:true 创建后记账，磁盘上已有的同名文件由适配层换序号。
    const createdFiles = new Set<string>()

    function directoryHandle(path: string[]) {
      return {
        name: path.at(-1) ?? 'E2E 配置导出目录',
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
                throw new Error('探测句柄不应被写入')
              },
            }
          }

          createdFiles.add(fullPath)
          const record: ConfigExportWriteRecord = {
            path: fullPath,
            bytes: [],
            closed: false,
          }
          return {
            async createWritable() {
              return {
                async write(data: Uint8Array) {
                  if (testWindow.__configExportTest.failWrites > 0) {
                    testWindow.__configExportTest.failWrites -= 1
                    throw new Error('模拟写盘失败')
                  }
                  await new Promise(resolve => setTimeout(resolve, 120))
                  record.bytes = Array.from(data)
                  testWindow.__configExportTest.writes.push(record)
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
        testWindow.__configExportTest.pickerCalls += 1
        return directoryHandle([])
      },
    })
  }, { initialFailWrites: failWrites })
}

async function observeStepper(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as ConfigExportTestWindow
    const capture = () => {
      const states = [...document.querySelectorAll<HTMLElement>('[aria-label="处理步骤"] [data-state]')]
        .map(element => element.dataset.state ?? '')
      if (states.length)
        testWindow.__configExportTest.stepStates.push(states)
    }
    new MutationObserver(capture).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    })
  })
}

test('配置导出：实时预览、二级写盘、逐步完成并自动关闭页签', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await installDirectoryPicker(page)
  await page.goto('/dev/kit-ui')
  await page.waitForLoadState('networkidle')

  await expect(page.getByTitle('当前页签数量')).toContainText('2 个页签')
  await page.getByRole('button', { name: '打开多表导出配置' }).click()
  await expect(page).toHaveURL(/\/export\/config\/[^/]+$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')
  await expect(page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '导出配置', exact: true })).toBeVisible()

  const preview = page.getByRole('status')
  await expect(preview).toHaveText('滨江壹号/材料采购/华东建材_CG-2026-001.txt')
  await page.getByLabel('二级目录字段').selectOption('supplierName')
  await page.getByLabel('分隔符').fill('-')
  await page.getByLabel('扩展名').fill('md')
  await expect(preview).toHaveText('滨江壹号/华东建材/华东建材-CG-2026-001.md')

  await observeStepper(page)
  await page.getByRole('button', { name: '开始导出' }).click()
  const activeWriteStep = page.locator('[aria-label="处理步骤"] [data-state="active"]').filter({ hasText: '写盘' })
  await expect(activeWriteStep).toBeVisible()
  await expect(activeWriteStep.locator('.border-brand')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: '处理进度' })).toHaveAttribute('aria-valuenow', '83')

  const systemToaster = page.locator('[data-sonner-toaster][data-y-position="top"]')
  const processToaster = page.locator('[data-sonner-toaster][data-y-position="bottom"]')
  const success = systemToaster.getByText('已导出到 E2E 配置导出目录 文件夹', { exact: true })
  await expect(success).toBeVisible()
  await expect(success).toHaveCount(1)
  await expect(processToaster.getByText('已导出到 E2E 配置导出目录 文件夹', { exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/\/dev\/kit-ui$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('2 个页签')
  await expect(page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '导出配置', exact: true })).toHaveCount(0)

  const state = await page.evaluate(() => (window as ConfigExportTestWindow).__configExportTest)
  expect(state.pickerCalls).toBe(1)
  expect(state.writes.map(write => write.path)).toEqual([
    '滨江壹号/华东建材/华东建材-CG-2026-001.md',
    '滨江壹号/南方设备/南方设备-CG-2026-002.md',
  ])
  expect(state.writes.every(write => write.closed)).toBe(true)
  expect(new TextDecoder().decode(new Uint8Array(state.writes[0]!.bytes))).toContain('华东建材')
  for (const index of [0, 1, 2]) {
    expect(state.stepStates.some(steps => steps[index] === 'active')).toBe(true)
    expect(state.stepStates.some(steps => steps[index] === 'completed')).toBe(true)
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-ripple], .ripple')).toHaveCount(0)
  expect(pageErrors, '配置导出完整旅程不应产生客户端运行错误').toEqual([])
})

test('配置导出：写盘失败保留页签并从失败步骤重试', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await installDirectoryPicker(page, 1)
  await page.goto('/dev/kit-ui')
  await page.getByRole('button', { name: '打开多表导出配置' }).click()
  await expect(page).toHaveURL(/\/export\/config\/[^/]+$/)

  const configUrl = page.url()
  await page.getByRole('button', { name: '开始导出' }).click()
  await expect(page.getByRole('heading', { name: '导出未完成' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('模拟写盘失败')
  const failedStep = page.locator('[aria-label="处理步骤"] [data-state="failed"]')
  await expect(failedStep).toContainText('写盘')
  await expect(failedStep.locator('.border-danger')).toBeVisible()
  await expect(page.locator('[aria-label="处理步骤"] [data-state="completed"]').first().locator('.border-ok')).toBeVisible()
  await expect(page).toHaveURL(configUrl)
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')

  await page.getByRole('button', { name: '重试失败步骤' }).click()
  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]')
    .getByText('已导出到 E2E 配置导出目录 文件夹', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/dev\/kit-ui$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('2 个页签')

  const state = await page.evaluate(() => (window as ConfigExportTestWindow).__configExportTest)
  expect(state.pickerCalls).toBe(2)
  expect(state.writes).toHaveLength(2)
  expect(pageErrors, '失败与重试旅程不应产生客户端运行错误').toEqual([])
})

test('配置导出：普通浏览器下载不伪装成二级目录写盘成功', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined,
    })
  })
  await page.goto('/dev/kit-ui')
  await page.getByRole('button', { name: '打开多表导出配置' }).click()
  await page.getByRole('button', { name: '开始导出' }).click()

  await expect(page.getByRole('heading', { name: '导出未完成' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('当前浏览器不支持保留目录结构')
  await expect(page).toHaveURL(/\/export\/config\/[^/]+$/)
  await expect(page.getByTitle('当前页签数量')).toContainText('3 个页签')
  await expect(page.locator('[data-sonner-toaster][data-y-position="top"]').getByText(/已导出到/)).toHaveCount(0)
})
