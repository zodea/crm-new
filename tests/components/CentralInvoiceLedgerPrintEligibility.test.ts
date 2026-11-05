import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {}, exportFile: vi.fn() }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function invoice(id: string): CentralInvoiceRecord {
  return {
    id,
    version: '3',
    sourceKind: 'scan',
    fields: { invoiceNumber: id, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
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
    original: { id: `original-${id}`, fileName: `${id}.pdf`, fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function fixture(records: CentralInvoiceRecord[]) {
  return {
    records: shallowRef(records),
    loading: shallowRef(false),
    readState: shallowRef<'ready' | 'loading' | 'unavailable'>('ready'),
    pendingPrint: () => null,
    load: vi.fn(async () => {}),
    verifiedOriginal: vi.fn(async (_record: CentralInvoiceRecord) => new Blob()),
    recordPrinted: vi.fn(async (_targets: unknown) => {}),
  }
}

it('混选时逐票说明不可打印原因，核验原件后仅登记合格扫描票', async () => {
  const ok = invoice('可打印')
  const excel = { ...invoice('Excel票'), sourceKind: 'excel' as const, original: null }
  const missingOriginal = { ...invoice('缺原件'), original: null }
  const unknown = invoice('缺金额')
  unknown.fields.totalAmount = null
  const zero = invoice('零金额')
  zero.fields.totalAmount = 0
  const attached = { ...invoice('已关联Excel'), sourceKind: 'excel' as const }
  const workspace = fixture([ok, excel, missingOriginal, unknown, zero, attached])
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  for (const record of workspace.records.value)
    await fireEvent.click(await screen.findByLabelText(`选择发票 ${record.id}`))
  expect(screen.getByText('已选 6 张 · 合计未统计（金额缺失或超出范围）')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  const excluded = screen.getByRole('region', { name: '不能打印的发票' })
  for (const [id, reason] of [
    ['Excel票', 'Excel 导入的发票没有原件'],
    ['缺原件', '发票未关联原件'],
    ['缺金额', '价税合计未填写'],
    ['零金额', '价税合计不是有效正数'],
    ['已关联Excel', '当前票据来源不支持打印'],
  ] as const) {
    expect((within(excluded).getByRole('checkbox', { name: `勾选发票 ${id}` }) as HTMLInputElement).disabled).toBe(true)
    expect(within(excluded).getByText(new RegExp(`${id}：${reason}`))).toBeTruthy()
    expect(document.querySelector(`.invoice-print-output [data-print-invoice-id="${id}"]`)).toBeNull()
  }
  expect(document.querySelector('.invoice-print-output [data-print-invoice-id="可打印"]')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(printed).toHaveBeenCalledOnce())
  expect(workspace.verifiedOriginal).toHaveBeenCalledTimes(1)
  expect(workspace.verifiedOriginal).toHaveBeenCalledWith(expect.objectContaining({ id: '可打印', version: '3' }), true)
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '已打印' })))
  await fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /打印选中/ })))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(printed).toHaveBeenCalledTimes(2))
  await fireEvent.click(screen.getByRole('button', { name: '已打印' }))
  await waitFor(() => expect(workspace.recordPrinted).toHaveBeenCalledWith([{ invoiceId: '可打印', baseVersion: '3', rotation: 0 }]))
})

it('全部不合格仍可逐票核对原因，但无法打印或登记', async () => {
  const missing = { ...invoice('没有原件'), original: null }
  const workspace = fixture([missing])
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 没有原件'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  const excluded = screen.getByRole('region', { name: '不能打印的发票' })
  expect(within(excluded).getByText(/发票未关联原件/)).toBeTruthy()
  expect((screen.getByRole('button', { name: /打印选中/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(printed).not.toHaveBeenCalled()
  expect(workspace.verifiedOriginal).not.toHaveBeenCalled()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('afterprint 早于打印媒体退出时，等待媒体切回屏幕后聚焦确认', async () => {
  const workspace = fixture([invoice('媒体焦点')])
  let change: ((event: MediaQueryListEvent) => void) | undefined
  const media = {
    matches: true,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      change = listener
    }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 媒体焦点'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(printed).toHaveBeenCalledOnce())
  await waitFor(() => expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function)))
  media.matches = false
  change!({ matches: false } as MediaQueryListEvent)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '已打印' })))
  expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
})

it('等待媒体恢复时来源失效，清除焦点监听且不重新显示旧确认', async () => {
  const workspace = fixture([invoice('媒体失效')])
  let change: ((event: MediaQueryListEvent) => void) | undefined
  const media = {
    matches: true,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      change = listener
    }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 媒体失效'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function)))
  workspace.readState.value = 'unavailable'
  expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  media.matches = false
  change!({ matches: false } as MediaQueryListEvent)
  await screen.findByText('发票来源或权限已变化，请重新读取。')
  expect(screen.queryByRole('button', { name: '已打印' })).toBeNull()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('原件核验期间失去权限时不打印、不登记', async () => {
  const workspace = fixture([invoice('权限变化')])
  workspace.verifiedOriginal.mockImplementation(async () => {
    workspace.readState.value = 'unavailable'
    throw new Error('身份或权限已变化')
  })
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 权限变化'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await screen.findByText('发票来源或权限已变化，请重新读取。')
  expect(screen.queryByText(/发票 权限变化 的原件/)).toBeNull()
  expect(screen.queryByRole('region', { name: '不能打印的发票' })).toBeNull()
  expect(printed).not.toHaveBeenCalled()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('原件读取失败后列出未核验原因，重新核验成功才可打印', async () => {
  const workspace = fixture([invoice('原件异常')])
  workspace.verifiedOriginal.mockRejectedValueOnce(new Error('摘要不一致')).mockResolvedValue(new Blob())
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 原件异常'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await screen.findByText('发票 原件异常 的原件读取或核验失败，不能打印。')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
  const excluded = screen.getByRole('region', { name: '不能打印的发票' })
  expect(within(excluded).getByText(/原件读取或核验未完成/)).toBeTruthy()
  expect((within(excluded).getByRole('checkbox', { name: '勾选发票 原件异常' }) as HTMLInputElement).disabled).toBe(true)
  expect(printed).not.toHaveBeenCalled()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
  await fireEvent.click(within(excluded).getByRole('button', { name: '重新核验' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(printed).toHaveBeenCalledOnce())
  expect(workspace.verifiedOriginal).toHaveBeenCalledTimes(2)
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('逐张串行核验原件，不等待完成就不打开打印窗口', async () => {
  const workspace = fixture([invoice('第一张'), invoice('第二张')])
  let releaseFirst!: () => void
  workspace.verifiedOriginal.mockImplementation(async (record) => {
    if (record.id === '第一张')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
    return new Blob()
  })
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 第一张'))
  await fireEvent.click(screen.getByLabelText('选择发票 第二张'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(workspace.verifiedOriginal).toHaveBeenCalledTimes(1))
  expect(printed).not.toHaveBeenCalled()
  releaseFirst()
  await waitFor(() => expect(printed).toHaveBeenCalledOnce())
  expect(workspace.verifiedOriginal.mock.calls.map(call => call[0].id)).toEqual(['第一张', '第二张'])
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('打印窗口关闭后来源失效时不能登记打印记录', async () => {
  const workspace = fixture([invoice('来源变化')])
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 来源变化'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(printed).toHaveBeenCalledOnce())
  const confirm = screen.getByRole('button', { name: '已打印' })
  workspace.readState.value = 'unavailable'
  await fireEvent.click(confirm)
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('打印前重新读取来源失败时不核验原件、不打印也不登记', async () => {
  const workspace = fixture([invoice('读取失败')])
  workspace.load.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
    workspace.readState.value = 'unavailable'
    throw new Error('发票来源读取失败')
  })
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 读取失败'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await screen.findByText('发票来源或权限已变化，请重新读取。')
  expect(workspace.verifiedOriginal).not.toHaveBeenCalled()
  expect(printed).not.toHaveBeenCalled()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('原件校验后版本变化时拒绝打印与登记', async () => {
  const workspace = fixture([invoice('版本变化')])
  let loads = 0
  workspace.load.mockImplementation(async () => {
    loads++
    if (loads === 3)
      workspace.records.value = workspace.records.value.map(record => ({ ...record, version: '4' }))
  })
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 版本变化'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await screen.findByText('打印票据已变化或不再满足打印条件，请返回台账重新选择。')
  expect(workspace.verifiedOriginal).toHaveBeenCalledOnce()
  expect(printed).not.toHaveBeenCalled()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('原编号存储不可核验时阻断打印，可重试读取', async () => {
  const workspace = fixture([invoice('存储检查')])
  let unavailable = true
  workspace.pendingPrint = () => {
    if (unavailable)
      throw new Error('storage unavailable')
    return null
  }
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await waitFor(() => expect(screen.getByText('打印记录存储暂不可核验，不能开始打印。')).toBeTruthy())
  expect((screen.getByRole('button', { name: '打印所选' }) as HTMLButtonElement).disabled).toBe(true)
  expect(printed).not.toHaveBeenCalled()
  unavailable = false
  await fireEvent.click(screen.getByRole('button', { name: '重新核验打印记录' }))
  await fireEvent.click(screen.getByLabelText('选择发票 存储检查'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(printed).toHaveBeenCalledOnce())
})

it('没有同步完成事件时提示可能已输出，迟到事件不允许登记', async () => {
  const workspace = fixture([invoice('异步打印')])
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {})
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 异步打印'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await screen.findByText('无法确认系统打印窗口是否结束，纸张可能已经输出，请先人工核对后再操作。')
  expect(printed).toHaveBeenCalledOnce()
  expect(document.querySelector('.central-print-unverified')).toBeTruthy()
  window.dispatchEvent(new Event('afterprint'))
  expect(screen.queryByRole('button', { name: '已打印' })).toBeNull()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})

it('切换工作区后同编号同版本的迟到原件不得恢复旧票面或打印', async () => {
  const previous = fixture([invoice('旧票')])
  let release!: () => void
  previous.verifiedOriginal.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return new Blob()
  })
  const replacement = invoice('旧票')
  replacement.fields.invoiceNumber = '新票'
  const next = fixture([replacement])
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  const workspaceProp = shallowRef(previous)
  const Host = defineComponent({ setup: () => () => h(CentralInvoiceLedgerScreen, { workspace: workspaceProp.value as never, projects: [] }) })
  render(Host)
  await fireEvent.click(await screen.findByLabelText('选择发票 旧票'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(previous.verifiedOriginal).toHaveBeenCalledOnce())
  workspaceProp.value = next
  await nextTick()
  release()
  await screen.findByText('发票来源或权限已变化，请重新读取。')
  await waitFor(() => expect(screen.getByRole('button', { name: '新票' })).toBeTruthy())
  expect(screen.queryByText('旧票')).toBeNull()
  expect(printed).not.toHaveBeenCalled()
  expect(previous.recordPrinted).not.toHaveBeenCalled()
  expect(next.recordPrinted).not.toHaveBeenCalled()
})

it('失权后恢复来源，旧原件迟到失败不得重现旧票号', async () => {
  const workspace = fixture([invoice('失权旧票')])
  let rejectOriginal!: (error: Error) => void
  workspace.verifiedOriginal.mockImplementation(async () => new Promise<Blob>((_resolve, reject) => {
    rejectOriginal = reject
  }))
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  render(CentralInvoiceLedgerScreen, { props: { workspace: workspace as never, projects: [] } })
  await fireEvent.click(await screen.findByLabelText('选择发票 失权旧票'))
  await fireEvent.click(screen.getByRole('button', { name: '打印所选' }))
  await fireEvent.click(screen.getByRole('button', { name: /打印选中/ }))
  await waitFor(() => expect(workspace.verifiedOriginal).toHaveBeenCalledOnce())
  workspace.readState.value = 'unavailable'
  workspace.records.value = []
  workspace.readState.value = 'ready'
  rejectOriginal(new Error('旧请求失败'))
  await screen.findByText('发票来源或权限已变化，请重新读取。')
  await waitFor(() => expect(screen.queryByText(/失权旧票/)).toBeNull())
  expect(printed).not.toHaveBeenCalled()
  expect(workspace.recordPrinted).not.toHaveBeenCalled()
})
