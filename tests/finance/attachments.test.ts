import type { FileRefRecord } from '~/lib/forms/file-refs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'
import { useFinanceFormAttachments } from '~/composables/useFinanceFormAttachments'

const feedback = { warning: vi.fn(), error: vi.fn() }
let scope: ReturnType<typeof effectScope>
function open() {
  scope = effectScope()
  const kind = shallowRef<'reimbursement' | 'payment_record'>('reimbursement')
  return { ...scope.run(() => useFinanceFormAttachments(kind))!, kind }
}
const file = (id: string, deletedAt: string | null = null): FileRefRecord => ({ id, ownerType: 'expense_reimbursement', ownerId: 'expense', fileName: `${id}.pdf`, filePath: '', fileSize: 0, mimeType: '', category: '', uploader: '', uploadedAt: '', deletedAt })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('useKitUI', () => feedback)
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('f3 原件准备与发送稿确认', () => {
  it('浏览器保存原字节及真实空文件', async () => {
    const form = open()
    await form.handleFiles([new File([new Uint8Array([0, 128, 255])], '原件.bin'), new File([], '真实空件')])
    expect(form.changes().add).toEqual([expect.objectContaining({ fileName: '原件.bin', fileSize: 3, payloadBase64: 'AID/' }), expect.objectContaining({ fileName: '真实空件', fileSize: 0, payloadBase64: '' })])
  })

  it('确认仅清除已发送稿，后来新增、改分类、撤销删除/恢复意图均保留', async () => {
    const form = open()
    form.reset([file('active'), file('deleted', 'old')])
    form.toggleExisting('active')
    form.toggleExisting('deleted')
    await form.handleFiles([new File(['first'], '先发.txt')])
    const sent = form.capture()
    form.toggleExisting('active')
    form.toggleExisting('deleted')
    form.patchPending(sent.add[0]!.localId, { category: '后来分类' })
    await form.handleFiles([new File(['later'], '后来.txt')])
    form.acknowledge([file('active', 'saved'), file('deleted'), file('new')], sent, ['new'])
    expect(form.pendingAttachments.value.map(item => item.fileName)).toEqual(['先发.txt', '后来.txt'])
    expect(form.changes()).toMatchObject({ restoreIds: ['active'], removeIds: ['deleted', 'new'] })
    expect(form.pendingAttachments.value[0]?.category).toBe('后来分类')
    expect(sent.add[0]?.category).toBe('业务附件')
  })

  it('离开或切换领域使旧读取失效，旧 finally 不解锁另一份仍读取的文件', async () => {
    const form = open()
    let finishA!: (value: ArrayBuffer) => void
    let finishB!: (value: ArrayBuffer) => void
    const delayed = (name: string, resolve: (fn: (v: ArrayBuffer) => void) => void) => ({ name, type: '', arrayBuffer: () => new Promise<ArrayBuffer>(resolve) }) as File
    const a = form.handleFiles([delayed('A', (fn) => {
      finishA = fn
    })])
    form.kind.value = 'payment_record'
    const b = form.handleFiles([delayed('B', (fn) => {
      finishB = fn
    })])
    finishA(new Uint8Array([1]).buffer)
    await a
    expect(form.pendingAttachments.value).toHaveLength(0)
    expect(form.readingFiles.value).toBe(true)
    finishB(new Uint8Array([2]).buffer)
    await b
    expect(form.pendingAttachments.value).toEqual([expect.objectContaining({ fileName: 'B', category: '付款回单' })])
    expect(form.readingFiles.value).toBe(false)
    const c = form.handleFiles([delayed('C', (fn) => {
      finishA = fn
    })])
    form.invalidatePreparation()
    finishA(new ArrayBuffer(0))
    await c
    expect(form.pendingAttachments.value).toHaveLength(1)
  })
})
