import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const FONT_PATH = fileURLToPath(new URL('../../tests/fixtures/visual-font/NotoSansSC-variable.ttf', import.meta.url))
const FONT_URL = '/__visual-fixtures/NotoSansSC-variable.ttf'

export async function installVisualFont(page: Page) {
  await page.route(`**${FONT_URL}`, route => route.fulfill({ path: FONT_PATH, contentType: 'font/ttf' }))
  await page.addInitScript((fontUrl) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = `
        @font-face {
          font-family: "Visual Noto Sans SC";
          src: url("${fontUrl}") format("truetype");
          font-style: normal;
          font-weight: 100 900;
          font-display: block;
        }
        :root {
          --font-sans: "Visual Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif !important;
        }
      `
      document.head.appendChild(style)
    }, { once: true })
  }, FONT_URL)
}

export async function visualFontLoaded(page: Page) {
  return page.evaluate(async () => {
    const faces = await Promise.all([400, 700].map(weight =>
      document.fonts.load(`${weight} 14px "Visual Noto Sans SC"`, '测试 Aa'),
    ))
    await document.fonts.ready
    return faces.every(group => group.length > 0 && group.every(face => face.status === 'loaded'))
  })
}
