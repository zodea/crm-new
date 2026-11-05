import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { useCentralInvoicePrint } from '~/composables/useCentralInvoicePrint'

function record(id: string): CentralInvoiceRecord {
  return { id, version: '1', sourceKind: 'scan', fields: { invoiceNumber: id, invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 10, taxRate: '', remark: '' }, items: [], unrecognizedPageIndexes: [], ocrStatus: 'done', completionMethod: 'ocr', reviewStatus: 'reviewed', accountStatus: 'archived', duplicateStatus: 'normal', printCount: 0, printRotation: 0, ownerKind: 'project', projectId: 'project-one', supplierId: null, contract: null, archivedAt: '2026-01-01T00:00:00.000Z', original: { id: `file-${id}`, fileName: '合成.png', fileSize: 1, mimeType: 'image/png', sha256: 'a'.repeat(64) }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
}

it('两个打印实例相互隔离，旧原件迟到不能恢复已撤销的打印任务', async () => {
  const first = record('first')
  const second = record('second')
  let finishOriginal!: () => void
  let firstGeneration = 0
  const workspace = {
    readState: shallowRef('ready'),
    pendingPrint: () => null,
    load: vi.fn(async () => {}),
    verifiedOriginal: vi.fn(() => new Promise<void>((resolve) => { finishOriginal = resolve })),
  }
  const busyA = shallowRef(false)
  const busyB = shallowRef(false)
  const make = (busy: typeof busyA, records: CentralInvoiceRecord[], generation: () => number) => useCentralInvoicePrint({
    workspace: () => workspace as never,
    records: shallowRef(records),
    busy,
    error: shallowRef(''),
    rootRef: shallowRef(null),
    generation,
    active: () => true,
    canPrepare: () => true,
    confirmLeave: async () => true,
    run: async (operation) => {
      busy.value = true
      try {
        await operation()
      }
      finally {
        busy.value = false
      }
    },
  })
  const a = make(busyA, [first], () => firstGeneration)
  const b = make(busyB, [second], () => 0)
  a.preparePrint([first])
  b.preparePrint([second])
  expect(a.printModels.value.map(item => item.id)).toEqual(['first'])
  expect(b.printModels.value.map(item => item.id)).toEqual(['second'])
  const printed = vi.spyOn(window, 'print').mockImplementation(() => {})
  try {
    const request = a.print({ ids: ['first'], rotations: { first: 0 }, perPage: 2, pageCount: 1, totalAmount: 10 })
    await vi.waitFor(() => expect(workspace.verifiedOriginal).toHaveBeenCalledOnce())
    firstGeneration++
    a.resetPrint()
    finishOriginal()
    await request
    expect(printed).not.toHaveBeenCalled()
    expect(a.printMode.value).toBe(false)
    expect(a.printModels.value).toEqual([])
    expect(b.printMode.value).toBe(true)
    expect(b.printModels.value.map(item => item.id)).toEqual(['second'])
  }
  finally {
    printed.mockRestore()
  }
})
