import type { DeliveryCentralRecord, DeliveryRevision } from '~/lib/delivery-record/contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import DeliveryRecordHistory from '~/components/delivery/DeliveryRecordHistory.vue'

const original: DeliveryCentralRecord = { id: 'record', dataOrigin: 'real', version: '1', uploadBatchId: 'upload', assetId: null, projectId: 'p', supplierId: 's', projectName: '中央项目', supplierName: '中央分供方', orderNo: 'DH', deliveryDate: '2026-09-11', note: '旧备注', rawSiteText: '旧工地原文', reviewFlag: '', lines: [{ id: 'line', deliveryRecordId: 'record', materialName: '钢筋', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'ocr', note: '', sortOrder: 0, currentValueConfirmed: true }], fileName: '旧原件.pdf', filePath: '', hasSourceFile: false, ocrStatus: 'reviewed', reviewStatus: 'reviewed', currentValuesConfirmed: true, naturalKeyDuplicate: false, archived: true, stored: true, printBatchId: 'upload', printDisposition: 'pending', printedAt: '', printExcludedAt: '', totalAmount: 10, createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z', createdBy: '', updatedBy: '', deletedAt: null, migrationBatchId: 'batch', legacyAudit: null }
const revisions: DeliveryRevision[] = [{ id: 'revision', recordId: 'record', version: '2', action: 'revise', reason: '对照原件修正数量', actorId: '经办甲', createdAt: '2026-09-11T01:00:00.000Z', before: original, after: { ...original, version: '2', assetId: 'new-asset', hasSourceFile: true, note: '新备注', lines: [{ ...original.lines[0]!, qty: 2, amount: 20 }], totalAmount: 20 }, changes: [] }]
const history = vi.fn()
const store = reactive({ origin: 'real', sourceVersion: '2', history })
function mount() {
  return render(DeliveryRecordHistory, { props: { recordId: 'record', currentVersion: '2' }, global: { components: {
    KitButton: defineComponent({ props: ['disabled', 'loading'], template: '<button :disabled="disabled || loading"><slot /></button>' }),
    KitTable: defineComponent({ props: ['data'], setup: props => () => h('div', { 'aria-label': '历史材料' }, props.data.map((row: { qty: number }) => `数量 ${row.qty}`).join(',')) }),
    DeliveryRecordSourcePanel: defineComponent({ props: { recordId: String, assetId: String, readOnly: Boolean }, setup: props => () => h('div', { 'aria-label': '历史原件', 'data-asset': props.assetId ?? 'missing', 'data-readonly': String(props.readOnly) }, props.assetId ? '关联原件' : '历史未关联原件') }),
  } } })
}
beforeEach(() => {
  history.mockReset().mockResolvedValue(revisions)
  store.origin = 'real'
  store.sourceVersion = '2'
  vi.stubGlobal('useDeliveryRecordStore', () => store)
})

describe('送货只读修订历史', () => {
  it('按需读取真实原因、操作者、时间和修改前后明细，旧无原件不借当前文件', async () => {
    mount()
    expect(history).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '查看修订历史' }))
    await flushPromises()
    expect(screen.getByText('对照原件修正数量')).toBeTruthy()
    expect(screen.getByText('经办甲')).toBeTruthy()
    expect(screen.getByText('2026-09-11T01:00:00.000Z')).toBeTruthy()
    expect(screen.getByLabelText('历史材料').textContent).toContain('数量 2')
    expect(screen.getByLabelText('历史原件').getAttribute('data-asset')).toBe('new-asset')
    await fireEvent.click(screen.getByRole('button', { name: '修改前' }))
    expect(screen.getByLabelText('历史材料').textContent).toContain('数量 1')
    expect(screen.getByLabelText('历史原件').getAttribute('data-asset')).toBe('missing')
    expect(screen.getByLabelText('历史原件').getAttribute('data-readonly')).toBe('true')
    expect(screen.queryByRole('button', { name: /保存|编辑|替换/ })).toBeNull()
  })

  it('当前来源变化撤下历史与原件，取消在途读取，迟到结果不落入新记录', async () => {
    const view = mount()
    let resolve!: (result: DeliveryRevision[]) => void
    history.mockImplementationOnce(() => new Promise<DeliveryRevision[]>((done) => {
      resolve = done
    }))
    await fireEvent.click(screen.getByRole('button', { name: '查看修订历史' }))
    const signal = history.mock.calls[0]![1].signal
    await view.rerender({ recordId: 'other', currentVersion: '1' })
    expect(signal.aborted).toBe(true)
    resolve(revisions)
    await flushPromises()
    expect(screen.queryByText('对照原件修正数量')).toBeNull()
    expect(screen.queryByLabelText('历史原件')).toBeNull()
  })

  it('历史祖先读取失败显示明确错误且可重试，不复用旧历史', async () => {
    mount()
    history.mockRejectedValueOnce(new Error('历史归属已失效，请重新对账'))
    await fireEvent.click(screen.getByRole('button', { name: '查看修订历史' }))
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain('历史归属已失效')
    expect(screen.queryByLabelText('历史原件')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取历史' }))
    await flushPromises()
    expect(screen.getByText('对照原件修正数量')).toBeTruthy()
  })
})
