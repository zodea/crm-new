import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceQueue from '~/components/invoice/CentralInvoiceQueue.vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

const confirm = vi.hoisted(() => vi.fn(async () => false))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

const records = [
  { id: 'one', fields: { invoiceNumber: '001ABC', buyer: '甲方公司', seller: '东部供应', totalAmount: 0 }, original: { fileName: 'one.PDF' }, ocrStatus: 'done', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
  { id: 'two', fields: { invoiceNumber: '002XYZ', buyer: '乙方企业', seller: '西部供应', totalAmount: null }, original: { fileName: 'two.png' }, ocrStatus: 'pending', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
  { id: 'three', fields: { invoiceNumber: '', buyer: '', seller: '', totalAmount: null }, original: null, ocrStatus: 'failed', printCount: 0, reviewStatus: 'unreviewed', accountStatus: 'none' },
] as CentralInvoiceRecord[]

it('队列按已保存票号、原件文件名和买卖方搜索，不触发选票', async () => {
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: null, projects: [] } })
  const search = screen.getByLabelText('搜索发票队列') as HTMLInputElement
  for (const term of ['  001abc  ', 'one.pdf', '甲方', '东部']) {
    await fireEvent.update(search, term)
    expect(screen.getByRole('button', { name: /001ABC/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /002XYZ/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /未填写票号/ })).toBeNull()
  }
  await fireEvent.update(search, '不存在')
  expect(screen.getByText('当前已读取的发票中没有匹配结果。')).toBeTruthy()
  expect(view.emitted('select')).toBeUndefined()
  await fireEvent.update(search, '')
  expect(screen.getByRole('button', { name: /002XYZ/ })).toBeTruthy()
  expect(within(screen.getByRole('button', { name: /001ABC/ })).getByText('价税合计 0')).toBeTruthy()
})
it('搜索未命中时保留当前选中项，不切换或放弃草稿', async () => {
  const view = render(CentralInvoiceQueue, { props: { records, selectedId: 'one', projects: [] } })
  await fireEvent.update(screen.getByLabelText('搜索发票队列'), '002XYZ')
  expect(screen.getByRole('button', { name: /001ABC/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: /002XYZ/ })).toBeTruthy()
  expect(screen.getByText('当前选中发票不符合搜索条件，仍保留以便继续处理。')).toBeTruthy()
  expect(view.emitted('select')).toBeUndefined()
})
it('工作台搜索保留未保存输入，仍通过离开保护；失权和换实例清词', async () => {
  const fullRecords = records.map(record => ({
    ...record,
    sourceKind: 'manual',
    version: '1',
    items: [],
    unrecognizedPageIndexes: [],
    completionMethod: null,
    duplicateStatus: 'normal',
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    fields: { ...record.fields, invoiceDate: '', invoiceType: '', buyerTaxNo: '', sellerTaxNo: '', amount: null, taxAmount: null, taxRate: '', remark: '' },
  })) as CentralInvoiceRecord[]
  function workspace() {
    return { records: shallowRef(fullRecords), loading: shallowRef(false), readState: shallowRef<'ready' | 'loading' | 'unavailable'>('ready'), load: vi.fn(async () => {}), pending: () => null, edit: vi.fn() }
  }
  const first = workspace()
  const second = workspace()
  const current = shallowRef(first)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceWorkspaceScreen, { workspace: current.value as never, projects: [], suppliers: [], signatories: [], initialSelectedId: 'one' }) })
  render(Host, { global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const search = await screen.findByLabelText('搜索发票队列') as HTMLInputElement
  await fireEvent.update(screen.getByLabelText('购买方'), '未保存购方')
  await fireEvent.update(search, '002XYZ')
  expect(screen.getByRole('button', { name: /001ABC/ }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.click(screen.getByRole('button', { name: /002XYZ/ }))
  expect(confirm).toHaveBeenCalledOnce()
  expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('未保存购方')
  expect(first.edit).not.toHaveBeenCalled()
  first.readState.value = 'loading'
  expect(search.value).toBe('002XYZ')
  first.readState.value = 'unavailable'
  first.readState.value = 'ready'
  await nextTick()
  expect(search.value).toBe('')
  await fireEvent.update(search, '西部')
  current.value = second
  await nextTick()
  expect(search.value).toBe('')
  expect(second.edit).not.toHaveBeenCalled()
})

it('重识别草稿票号未保存时仍按已保存票号搜索并保留草稿', async () => {
  const record = {
    id: 'draft-one',
    version: '1',
    sourceKind: 'scan',
    fields: { invoiceNumber: 'SAVE-001', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 10, taxRate: '', remark: '' },
    items: [],
    unrecognizedPageIndexes: [],
    ocrStatus: 'done',
    completionMethod: 'ocr',
    reviewStatus: 'reviewed',
    accountStatus: 'none',
    duplicateStatus: 'normal',
    printCount: 0,
    printRotation: 0,
    ownerKind: null,
    projectId: null,
    supplierId: null,
    contract: null,
    archivedAt: null,
    original: { id: 'original', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  } as CentralInvoiceRecord
  const candidate = { source: 'local' as const, fields: { ...record.fields, invoiceNumber: 'DRAFT-NEW', items: [], projectHint: '', balanced: false }, textPages: ['合成'], unrecognizedPageIndexes: [], requiresReview: true as const }
  const workspace = {
    records: shallowRef([record]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    load: vi.fn(async () => {}),
    pending: () => null,
    verifiedOriginal: vi.fn(async () => { throw new Error('合成原件暂不可读') }),
    prepareRerecognition: vi.fn(async () => candidate),
    saveRerecognition: vi.fn(),
  }
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [], initialSelectedId: record.id }, global: { stubs: { NuxtLink: true, InvoiceRegionViewer: true } } })
  const recognize = await screen.findByRole('button', { name: '本机重新识别' }) as HTMLButtonElement
  await waitFor(() => expect(recognize.disabled).toBe(false))
  await fireEvent.click(recognize)
  await waitFor(() => expect(workspace.prepareRerecognition).toHaveBeenCalledOnce())
  await screen.findByText(/重新识别结果为未保存草稿/)
  await fireEvent.update(screen.getByLabelText('搜索发票队列'), '不匹配')
  expect(within(screen.getByLabelText('发票队列')).getByRole('button', { name: /SAVE-001/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('当前选中发票不符合搜索条件，仍保留以便继续处理。')).toBeTruthy()
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  expect(workspace.saveRerecognition).not.toHaveBeenCalled()
})
