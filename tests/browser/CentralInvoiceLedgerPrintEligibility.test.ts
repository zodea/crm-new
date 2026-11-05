import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { cdp, page, userEvent } from 'vitest/browser'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: vi.fn() }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('混选原因可见，原件核验期间锁定打印选择并保留筛选后的排版', async () => {
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
  const scan: CentralInvoiceRecord = {
    id: 'scan',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: '扫描票', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: 'personal',
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: '2026-01-01T00:00:00.000Z',
    original: { id: 'original-scan', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
  const excel: CentralInvoiceRecord = { ...scan, id: 'excel', sourceKind: 'excel', fields: { ...scan.fields, invoiceNumber: 'Excel票', totalAmount: null }, original: null }
  const second: CentralInvoiceRecord = { ...scan, id: 'second', fields: { ...scan.fields, invoiceNumber: '第二张' }, original: { ...scan.original!, id: 'original-second' } }
  let release!: () => void
  const verifiedOriginal = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return new Blob()
  })
  const workspace = {
    records: shallowRef([scan, excel, second]),
    loading: shallowRef(false),
    readState: shallowRef<'ready' | 'loading'>('ready'),
    pendingPrint: () => null,
    load: vi.fn(async () => {
      workspace.readState.value = 'loading'
      await Promise.resolve()
      workspace.readState.value = 'ready'
    }),
    verifiedOriginal,
    recordPrinted: vi.fn(),
  }
  let controlledStyles: Record<string, string | boolean> | null = null
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    const output = document.querySelector<HTMLElement>('.invoice-print-output')!
    const invoice = output.querySelector<HTMLElement>('[data-print-invoice-id="scan"]')!
    const excluded = document.querySelector<HTMLElement>('section[aria-label="不能打印的发票"]')!
    const busy = [...document.querySelectorAll<HTMLElement>('[role="status"]')].find(element => element.textContent?.includes('正在处理打印'))!
    controlledStyles = {
      media: window.matchMedia('print').matches,
      gateOpen: !output.closest('.central-print-unverified'),
      output: getComputedStyle(output).display,
      invoice: getComputedStyle(invoice).visibility,
      excluded: getComputedStyle(excluded).display,
      busy: getComputedStyle(busy).display,
    }
    window.dispatchEvent(new Event('afterprint'))
  })
  await render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await page.getByLabelText('选择发票 扫描票').click()
  await page.getByLabelText('选择发票 Excel票').click()
  await page.getByLabelText('选择发票 第二张').click()
  const open = page.getByRole('button', { name: '打印所选' })
  ;(open.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  const excluded = page.getByRole('region', { name: '不能打印的发票' })
  await expect.element(excluded).toHaveTextContent('Excel 导入的发票没有原件')
  await expect.element(page.getByRole('checkbox', { name: '勾选发票 Excel票' })).toBeDisabled()
  const excludedElement = excluded.element() as HTMLElement
  const output = document.querySelector<HTMLElement>('.invoice-print-output')!
  const list = page.getByLabelText('待打印发票列表')
  await list.getByRole('checkbox', { name: '勾选发票 第二张' }).click()
  expect(document.querySelector('.invoice-print-output [data-print-invoice-id="second"]')).toBeNull()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const protocol = cdp()
  try {
    await protocol.send('Emulation.setEmulatedMedia', { media: 'print' })
    expect(window.matchMedia('print').matches).toBe(true)
    expect(getComputedStyle(excludedElement).display).toBe('none')
    expect(getComputedStyle(output).display).toBe('none')
    await protocol.send('Emulation.setEmulatedMedia', { media: '' })
    await page.getByRole('button', { name: /打印选中/ }).click()
    await expect.poll(() => verifiedOriginal.mock.calls.length).toBe(1)
    expect((excludedElement.parentElement as HTMLElement).inert).toBe(true)
    expect(printed).not.toHaveBeenCalled()
    const busy = page.getByText('正在处理打印，请稍候。').element() as HTMLElement
    await protocol.send('Emulation.setEmulatedMedia', { media: 'print' })
    expect(window.matchMedia('print').matches).toBe(true)
    expect(getComputedStyle(busy).display).toBe('none')
    expect(getComputedStyle(excludedElement).display).toBe('none')
    expect(getComputedStyle(output).display).toBe('none')
    release()
    await expect.poll(() => printed.mock.calls.length).toBe(1)
    expect(controlledStyles).toEqual({ media: true, gateOpen: true, output: 'block', invoice: 'visible', excluded: 'none', busy: 'none' })
    await expect.poll(() => !!output.closest('.central-print-unverified')).toBe(true)
    expect(getComputedStyle(output).display).toBe('none')
  }
  finally {
    await protocol.send('Emulation.setEmulatedMedia', { media: '' })
  }
  await expect.poll(() => (excludedElement.parentElement as HTMLElement).inert).toBe(false)
  await expect.element(page.getByRole('button', { name: '已打印' })).toHaveFocus()
  expect(document.querySelector('.invoice-print-output [data-print-invoice-id="second"]')).toBeNull()
  expect(verifiedOriginal).toHaveBeenCalledOnce()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})
