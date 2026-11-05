import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import CentralInvoiceWorkspaceView from '~/components/invoice/CentralInvoiceWorkspaceView.vue'

it('各视口可拖入发票，项目与公司归属、忙碌状态和键盘入口保持一致', async () => {
  const upload = vi.fn()
  const busy = ref(false)
  const projects = ref([{ id: 'project-one', label: '合成项目' }])
  await render(defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceView, {
    records: [],
    selectedId: null,
    originalFile: null,
    originalLoading: false,
    busy: busy.value,
    cloudAvailable: false,
    projects: projects.value,
    suppliers: [],
    signatories: [],
    onUpload: upload,
  }) }))
  const area = page.getByRole('region', { name: '发票识别与核对' })
  const transfer = new DataTransfer()
  transfer.items.add(new File(['%PDF-1.4'], 'synthetic.pdf', { type: 'application/pdf' }))
  const target = area.element()
  function dispatch(type: string, dataTransfer = transfer) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
  }
  dispatch('dragenter')
  await expect.element(page.getByText('拖入发票文件上传')).toBeVisible()
  dispatch('drop')
  await expect.element(page.getByText('请先选择可用的上传项目。')).toBeVisible()
  expect(upload).not.toHaveBeenCalled()
  await page.getByLabelText('上传项目').selectOptions('project-one')
  const button = page.getByLabelText('上传发票').element() as HTMLInputElement
  button.focus()
  await expect.element(page.getByLabelText('上传发票')).toHaveFocus()
  dispatch('drop')
  expect(upload).toHaveBeenCalledOnce()
  expect(upload.mock.calls[0]?.[1]).toBe('project-one')
  projects.value = []
  await nextTick()
  dispatch('drop')
  await expect.element(page.getByText('请先选择可用的上传项目。')).toBeVisible()
  expect(upload).toHaveBeenCalledOnce()
  await page.getByLabelText('上传归属').selectOptions('company')
  const tabs = document.querySelector('[data-workbench-tabs]') as HTMLElement
  if (getComputedStyle(tabs).display !== 'none')
    await page.getByRole('tab', { name: '原件' }).click()
  dispatch('drop')
  expect(upload).toHaveBeenCalledTimes(2)
  expect(upload.mock.calls[1]?.[1]).toBeNull()
  busy.value = true
  await nextTick()
  dispatch('drop')
  expect(upload).toHaveBeenCalledTimes(2)
  const textOnly = new DataTransfer()
  textOnly.setData('text/plain', 'not a file')
  dispatch('drop', textOnly)
  expect(upload).toHaveBeenCalledTimes(2)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})
