import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

const confirm = vi.hoisted(() => vi.fn(async () => true))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

function fixture() {
  const record: CentralInvoiceRecord = { id: 'invoice-one', version: '1', sourceKind: 'scan', fields: { invoiceNumber: '00123', invoiceDate: '', invoiceType: '', buyer: '已保存购方', buyerTaxNo: '', seller: '已保存销方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 10, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'done', completionMethod: 'ocr', reviewStatus: 'reviewed', accountStatus: 'none', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: null, contract: null, archivedAt: null, original: { id: 'original-one', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
  const candidate = { source: 'local' as const, fields: { ...record.fields, buyer: '识别购方', amount: 8, items: [], projectHint: '', balanced: false }, textPages: ['合成'], unrecognizedPageIndexes: [], requiresReview: true as const }
  const workspace = {
    records: shallowRef([record]),
    loading: shallowRef(false),
    readState: shallowRef('ready'),
    sourceVersion: shallowRef('invoices:1'),
    load: vi.fn(async () => {}),
    pending: vi.fn((_id: string | null): { action: string } | null => null),
    recover: vi.fn(async (_id: string | null) => ({ outcome: 'applied' as const, read: { record } })),
    original: async () => { throw new Error('合成原件暂不可读') },
    prepareRerecognition: vi.fn(async () => candidate),
    saveRerecognition: vi.fn(async () => record),
  }
  render(CentralInvoiceWorkspaceScreen, { props: { workspace: workspace as never, projects: [], suppliers: [], signatories: [], cloudAvailable: true }, global: { stubs: { NuxtLink: true } } })
  return { workspace, record, candidate }
}

beforeEach(() => confirm.mockReset().mockResolvedValue(true))

it('未保存文本、未完成金额和明细在识别失败或放弃结果后原样恢复，取消放弃不丢草稿', async () => {
  const f = fixture()
  await fireEvent.click(await screen.findByRole('button', { name: /00123/ }))
  await fireEvent.update(screen.getByLabelText('购买方'), '人工未保存购方')
  await fireEvent.update(screen.getByLabelText('不含税金额'), '1e')
  await fireEvent.click(screen.getByText(/货物明细/))
  await fireEvent.click(screen.getByRole('button', { name: '添加明细' }))
  await fireEvent.update(screen.getByLabelText('第 1 行名称'), '人工未保存明细')
  f.workspace.prepareRerecognition.mockRejectedValueOnce(new Error('识别失败'))
  await fireEvent.click(screen.getByRole('button', { name: '本机重新识别' }))
  await screen.findByText('识别失败')
  expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('人工未保存购方')
  expect((screen.getByLabelText('不含税金额') as HTMLInputElement).value).toBe('1e')
  expect((screen.getByLabelText('第 1 行名称') as HTMLInputElement).value).toBe('人工未保存明细')
  await fireEvent.click(screen.getByRole('button', { name: '本机重新识别' }))
  await screen.findByText(/重新识别结果为未保存草稿/)
  expect((screen.getByLabelText(/^购买方\s/) as HTMLInputElement).value).toBe('识别购方')
  expect(screen.getByText('识别变动（原值：人工未保存购方）')).toBeTruthy()
  confirm.mockResolvedValueOnce(false)
  await fireEvent.click(screen.getByRole('button', { name: '放弃识别草稿' }))
  expect((screen.getByLabelText(/^购买方\s/) as HTMLInputElement).value).toBe('识别购方')
  confirm.mockResolvedValueOnce(true)
  await fireEvent.click(screen.getByRole('button', { name: '放弃识别草稿' }))
  await waitFor(() => expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('人工未保存购方'))
  expect((screen.getByLabelText('不含税金额') as HTMLInputElement).value).toBe('1e')
  await fireEvent.click(screen.getByText(/货物明细/))
  expect((screen.getByLabelText('第 1 行名称') as HTMLInputElement).value).toBe('人工未保存明细')
  expect((screen.getByRole('button', { name: '归档发票' }) as HTMLButtonElement).disabled).toBe(true)
  expect(f.workspace.saveRerecognition).not.toHaveBeenCalled()
})

it('保存前对照识别前可见人工值，取消确认保留识别草稿', async () => {
  const f = fixture()
  await fireEvent.click(await screen.findByRole('button', { name: /00123/ }))
  await fireEvent.update(screen.getByLabelText('购买方'), '人工购方')
  await fireEvent.click(screen.getByRole('button', { name: '本机重新识别' }))
  await screen.findByText(/重新识别结果为未保存草稿/)
  confirm.mockResolvedValueOnce(false)
  await fireEvent.click(screen.getByRole('button', { name: '保存识别草稿' }))
  expect(confirm.mock.calls.at(-1)?.[0]).toMatchObject({ message: expect.stringContaining('购买方：人工购方 → 识别购方') })
  expect(f.workspace.saveRerecognition).not.toHaveBeenCalled()
  expect((screen.getByLabelText(/^购买方\s/) as HTMLInputElement).value).toBe('识别购方')
})

it('识别期间版本发生变化，不采用迟到结果并保留原输入', async () => {
  const f = fixture()
  let finish!: (value: typeof f.candidate) => void
  f.workspace.prepareRerecognition.mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve
  }))
  await fireEvent.click(await screen.findByRole('button', { name: /00123/ }))
  await fireEvent.update(screen.getByLabelText('购买方'), '人工购方')
  await fireEvent.click(screen.getByRole('button', { name: '本机重新识别' }))
  await waitFor(() => expect(f.workspace.prepareRerecognition).toHaveBeenCalledOnce())
  f.workspace.records.value = [{ ...f.record, version: '2', fields: { ...f.record.fields, buyer: '其他会话已更改' } }]
  await nextTick()
  finish(f.candidate)
  await screen.findAllByText('发票或权限已变化，未保存输入仍保留。')
  expect(screen.queryByText(/重新识别结果为未保存草稿/)).toBeNull()
  expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('人工购方')
  expect(f.workspace.saveRerecognition).not.toHaveBeenCalled()
})

it('识别期间失权后不显示迟到结果，恢复读取后保留原输入', async () => {
  const f = fixture()
  let finish!: (value: typeof f.candidate) => void
  f.workspace.prepareRerecognition.mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve
  }))
  await fireEvent.click(await screen.findByRole('button', { name: /00123/ }))
  await fireEvent.update(screen.getByLabelText('购买方'), '人工购方')
  await fireEvent.click(screen.getByRole('button', { name: '本机重新识别' }))
  await waitFor(() => expect(f.workspace.prepareRerecognition).toHaveBeenCalledOnce())
  f.workspace.readState.value = 'forbidden'
  await nextTick()
  finish(f.candidate)
  await screen.findAllByText('发票或权限已变化，未保存输入仍保留。')
  f.workspace.readState.value = 'ready'
  await nextTick()
  expect(screen.queryByText(/重新识别结果为未保存草稿/)).toBeNull()
  expect((screen.getByLabelText('购买方') as HTMLInputElement).value).toBe('人工购方')
})

it('提交结果未知时保留草稿，原编号确认已生效后清除草稿且不重复提交', async () => {
  const f = fixture()
  await fireEvent.click(await screen.findByRole('button', { name: /00123/ }))
  await fireEvent.update(screen.getByLabelText('购买方'), '人工购方')
  await fireEvent.click(screen.getByRole('button', { name: '本机重新识别' }))
  await screen.findByText(/重新识别结果为未保存草稿/)
  f.workspace.saveRerecognition.mockImplementationOnce(async () => {
    f.workspace.pending.mockImplementation(id => id ? { action: 'rerecognize' } : null)
    throw new Error('提交结果未知')
  })
  await fireEvent.click(screen.getByRole('button', { name: '保存识别草稿' }))
  await screen.findByText('提交结果未知')
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  f.workspace.recover.mockImplementationOnce(async () => {
    f.workspace.pending.mockReturnValue(null)
    f.workspace.records.value = [{ ...f.record, version: '2', fields: { ...f.record.fields, buyer: '识别购方' } }]
    return { outcome: 'applied', read: { record: f.workspace.records.value[0]! } }
  })
  await fireEvent.click(screen.getByRole('button', { name: '核对上次提交' }))
  await waitFor(() => expect(screen.queryByText(/重新识别结果为未保存草稿/)).toBeNull())
  expect(f.workspace.saveRerecognition).toHaveBeenCalledOnce()
  expect(f.workspace.recover).toHaveBeenCalledWith('invoice-one')
})

it('确认对照期间发票版本变化时保留草稿并拒绝提交', async () => {
  const f = fixture()
  await fireEvent.click(await screen.findByRole('button', { name: /00123/ }))
  await fireEvent.update(screen.getByLabelText('购买方'), '人工购方')
  await fireEvent.click(screen.getByRole('button', { name: '本机重新识别' }))
  await screen.findByText(/重新识别结果为未保存草稿/)
  let finish!: (value: boolean) => void
  confirm.mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve
  }))
  await fireEvent.click(screen.getByRole('button', { name: '保存识别草稿' }))
  f.workspace.records.value = [{ ...f.record, version: '2' }]
  await nextTick()
  finish(true)
  await screen.findByText('发票或权限已变化，识别草稿仍保留，请先核对最新版本。')
  expect(screen.getByText(/重新识别结果为未保存草稿/)).toBeTruthy()
  expect(f.workspace.saveRerecognition).not.toHaveBeenCalled()
})
