import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'
import InvoiceOriginalPanel from '~/pages/finance/invoice/_components/InvoiceOriginalPanel.vue'

it('旧工作台原件面板使用浏览器真实图片解码后定位，失败和重试不保留失效框', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 200
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法创建合成图片')), 'image/png'))
  const validFile = new File([blob], '合成发票.png', { type: 'image/png' })
  const file = shallowRef(validFile)
  const active = shallowRef<string | null>(null)
  const group = { id: 'invoice-number', pageIndex: 0, box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, keys: ['invoiceNumber'], labels: ['单据编号'] }
  const Host = defineComponent({ setup: () => () => h('main', [
    h('input', { 'aria-label': '合成票号', 'onFocus': () => { active.value = 'invoiceNumber' } }),
    h(InvoiceOriginalPanel, { invoice: { id: 'synthetic' } as never, file: file.value, regions: { mode: 'focus', groups: [group], unlocated: [], activeKey: active.value } }),
  ]) })
  await render(Host, { global: { components: { InvoiceRegionViewer } } })
  const image = page.getByRole('img', { name: '合成发票.png' })
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(300)
  await page.getByLabelText('合成票号').click()
  await expect.poll(() => document.querySelector('[data-testid="invoice-region-box"][data-active="true"]') !== null).toBe(true)
  await expect.element(page.getByText(/已定位：单据编号/)).toBeVisible()
  const region = page.getByRole('region', { name: '发票原图预览' })
  expect(region.element().querySelector('[data-testid="invoice-region-box"]')?.getAttribute('style')).toContain('left: 10%')
  await page.getByRole('button', { name: '原图向右旋转' }).click()
  expect(region.element().querySelector('[data-testid="invoice-region-box"]')?.getAttribute('style')).toContain('left: 70%')
  file.value = new File(['not-image'], '损坏合成.png', { type: 'image/png' })
  await expect.element(page.getByRole('alert')).toBeVisible()
  expect(document.querySelector('[data-testid="invoice-region-box"]')).toBeNull()
  file.value = validFile
  await expect.poll(() => (page.getByRole('img', { name: '合成发票.png' }).element() as HTMLImageElement).naturalWidth).toBe(300)
  await expect.poll(() => document.querySelector('[data-testid="invoice-region-box"][data-active="true"]') !== null).toBe(true)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
