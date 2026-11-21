import { expect, inject } from 'vitest'
import { page } from 'vitest/browser'

declare module 'vitest' {
  interface ProvidedContext {
    fullBrowserMatrix: boolean
  }
}

/** 日常复用已挂载的页面，完整矩阵由各浏览器实例设置视口。 */
export async function checkFinanceViewports(check: () => void) {
  if (inject('fullBrowserMatrix')) {
    check()
    return
  }
  const { innerWidth, innerHeight } = window
  try {
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.viewport(width, innerHeight)
      await expect.poll(() => window.innerWidth).toBe(width)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      check()
    }
  }
  finally {
    await page.viewport(innerWidth, innerHeight)
  }
}
