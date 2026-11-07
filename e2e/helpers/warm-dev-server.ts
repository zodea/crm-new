import type { FullConfig } from '@playwright/test'
import process from 'node:process'
import { chromium } from '@playwright/test'

/** CI 的 Vite 首次模块编译不应占用首个业务用例的时间预算。 */
export default async function warmDevServer(config: FullConfig) {
  const projectName = process.env.E2E_PROJECT ?? 'chromium'
  const project = config.projects.find(candidate => candidate.name === projectName)
  const baseURL = project?.use.baseURL
  if (typeof baseURL !== 'string')
    throw new Error(`无法确定开发服务地址：${projectName}`)

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL })
    const paths = process.env.E2E_PROJECT
      ? ['/project', '/project/project-real-320?origin=real', '/dev/kit-ui']
      : ['/subcontract/quantity?origin=real']
    for (const path of paths) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await page.locator('[data-shell-workspace]').waitFor({ state: 'visible', timeout: 90_000 })
      await page.waitForLoadState('networkidle', { timeout: 90_000 })
    }
  }
  finally {
    await browser.close()
  }
}
