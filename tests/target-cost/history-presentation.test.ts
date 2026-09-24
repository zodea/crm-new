import { describe, expect, it } from 'vitest'
import { presentTargetCostHistory } from '../../app/lib/target-cost/history-presentation'

describe('预算操作历史展示', () => {
  it('保留未知与真零差异，用预算字段标签和真实经办身份呈现', () => {
    const view = presentTargetCostHistory({ id: 'log', tableName: 'target_cost_items', recordId: 'item', operation: 'update', operatedAt: null, operator: null, beforeData: { item_name: null, qty: null, amount: 0 }, afterData: { item_name: '砌筑', qty: 0, amount: 0 } })
    expect(view).toMatchObject({ subject: '科目明细', action: '保存', time: '操作时间未提供', operator: '经办身份未提供' })
    expect(view.changes).toEqual([{ label: '分项名称', before: '未填写', after: '砌筑' }, { label: '数量', before: '未填写', after: '0' }])
  })
  it('软删恢复与缺失旧详情可读，未知字段不泄漏原始表结构', () => {
    const view = presentTargetCostHistory({ id: 'log', tableName: 'file_refs', recordId: 'file', operation: 'update', operatedAt: '2026-09-13', operator: '经办甲', beforeData: { deleted_at: '2026-09-12', internal_path: 'private' }, afterData: { deleted_at: null, internal_path: 'new' } })
    expect(view).toMatchObject({ subject: '预算附件', action: '恢复', operator: '经办甲', changes: [], missingDetail: '这条历史未保留可识别的业务字段变化。' })
    expect(JSON.stringify(view)).not.toContain('internal_path')
    expect(JSON.stringify(view)).not.toContain('private')
  })
})
