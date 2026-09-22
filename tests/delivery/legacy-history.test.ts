import type { DeliveryCentralRecord } from '~/lib/delivery-record/contract'
import { describe, expect, it } from 'vitest'
import { restoreLegacyDeliveryHistory } from '../../server/utils/delivery-legacy-history'

const record: DeliveryCentralRecord = {
  id: 'central-record',
  dataOrigin: 'real',
  version: '1',
  uploadBatchId: 'upload',
  assetId: 'current-asset',
  projectId: 'central-p',
  supplierId: 'central-s',
  projectName: '项目',
  supplierName: '分供方',
  orderNo: 'DH',
  deliveryDate: '2026-09-11',
  note: '现在',
  rawSiteText: '原始文字',
  reviewFlag: '',
  lines: [],
  fileName: '现在.pdf',
  filePath: '',
  hasSourceFile: true,
  ocrStatus: 'reviewed',
  reviewStatus: 'reviewed',
  currentValuesConfirmed: true,
  naturalKeyDuplicate: false,
  archived: true,
  stored: true,
  printBatchId: 'upload',
  printDisposition: 'printed',
  printedAt: '',
  printExcludedAt: '',
  totalAmount: 20,
  createdAt: '2026-09-10',
  updatedAt: '2026-09-11',
  createdBy: '',
  updatedBy: '',
  deletedAt: null,
  migrationBatchId: 'batch',
  legacyAudit: 'original audit retained',
}
const lines = [
  { id: 'old-line', recordId: 'legacy-record', materialName: '材料', spec: '', unit: '吨', qty: 1, unitPrice: 10, amount: 10, amountSource: 'manual', note: '', deletedAt: '2026-09-11' },
  { id: 'new-line', recordId: 'legacy-record', materialName: '材料', spec: '', unit: '吨', qty: 2, unitPrice: 10, amount: 20, amountSource: 'manual', note: '', deletedAt: null },
]
const head = { id: 'legacy-record', project_id: 'old-p', supplier_id: 'old-s', order_no: 'DH', delivery_date: '2026-09-11', note: '', raw_site_text: '原始文字', review_flag: '', file_name: '旧名.pdf', file_path: 'private-local-path', ocr_status: 'reviewed', archived: 1, print_disposition: 'pending', printed_at: '', print_excluded_at: '', created_at: '2026-09-10', updated_at: '2026-09-11', deleted_at: null }
const audit = [{ id: 'log', action: 'update', operator: '旧经办', createdAt: '2026-09-11', beforeData: JSON.stringify({ ...head, __delivery_line_ids: ['old-line'] }), afterData: JSON.stringify({ ...head, note: '修正数量', __delivery_line_ids: ['new-line'] }) }]
const resolve = (kind: 'projects' | 'suppliers', id: string) => id === (kind === 'projects' ? 'old-p' : 'old-s') ? { id: kind === 'projects' ? 'central-p' : 'central-s', name: kind === 'projects' ? '项目' : '分供方' } : null

describe('可证明的旧送货历史恢复', () => {
  it.each([
    { supplier_id: null },
    { delivery_date: '' },
    { delivery_date: '2026-02-31' },
    { __delivery_line_ids: [] },
  ])('旧 reviewed 标记不能把不完整头或空材料升级为人工已核验：%j', (missing) => {
    const log = { ...audit[0], beforeData: JSON.stringify({ ...head, __delivery_line_ids: ['old-line'], ...missing }), afterData: audit[0]!.afterData }
    const result = restoreLegacyDeliveryHistory(record, 'legacy-record', lines, [log], resolve)
    expect(result.revisions).toHaveLength(1)
    expect(result.revisions[0]?.before).toMatchObject({ currentValuesConfirmed: false, reviewStatus: 'unreviewed', ocrStatus: 'reviewed' })
    expect(result.revisions[0]?.before?.lines.every(line => !line.currentValueConfirmed)).toBe(true)
  })

  it('历史明细为零数量时保留原值但取消价格事实资格', () => {
    const result = restoreLegacyDeliveryHistory(record, 'legacy-record', lines.map(line => ({ ...line, qty: 0 })), audit, resolve)
    expect(result.revisions[0]?.after).toMatchObject({ currentValuesConfirmed: false, lines: [{ qty: 0, currentValueConfirmed: false }] })
  })

  it('按旧行 ID 恢复前后材料事实，保留操作者但不猜历史原件或修订原因', () => {
    const result = restoreLegacyDeliveryHistory(record, 'legacy-record', lines, audit, resolve)
    expect(result.revisions).toHaveLength(1)
    expect(result.revisions[0]).toMatchObject({ actorId: '旧经办', before: { lines: [{ qty: 1, amount: 10 }], assetId: null, filePath: '' }, after: { lines: [{ qty: 2, amount: 20 }], note: '修正数量', assetId: null } })
    expect(result.revisions[0]?.reason).toContain('未记录')
    expect(result.revisions[0]?.after.lines[0]?.id).toBe('central-record:line:new-line')
    expect(JSON.stringify(result.revisions)).not.toContain('private-local-path')
    expect(result.unresolvedCount).toBe(0)
    expect(result.currentVersion).toBe('2')
  })

  it.each([
    [{ ...audit[0], beforeData: 'not-json' }],
    [{ ...audit[0], beforeData: JSON.stringify({ ...head, __delivery_line_ids: ['missing-line'] }) }],
    [{ ...audit[0], beforeData: JSON.stringify({ ...head, project_id: 'unmapped', __delivery_line_ids: ['old-line'] }) }],
  ])('不完整或无法映射的旧快照只保留待核验，不生成假历史版', (log) => {
    const result = restoreLegacyDeliveryHistory(record, 'legacy-record', lines, [log], resolve)
    expect(result.revisions).toEqual([])
    expect(result.unresolvedCount).toBe(1)
    expect(result.currentVersion).toBe('1')
  })
})
