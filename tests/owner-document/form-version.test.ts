import { describe, expect, it } from 'vitest'
import {
  advanceOwnerDocumentFormVersion,
  initializeOwnerDocumentFormVersion,
  ownerDocumentFormCanRebase,
  rebaseOwnerDocumentFormVersion,
  requireOwnerDocumentFormVersion,
  withOwnerDocumentFormVersion,
} from '~/lib/owner-document/form-version'

describe('甲方商务单据表单实例版本', () => {
  it('同一单据的两个页面实例各自保留打开时版本，互不前移', () => {
    const firstTab = withOwnerDocumentFormVersion({ id: 'change-323', name: '页签一' }, '1')
    const secondTab = withOwnerDocumentFormVersion({ id: 'change-323', name: '页签二' }, '1')
    advanceOwnerDocumentFormVersion(firstTab, '2')

    expect(requireOwnerDocumentFormVersion(firstTab)).toBe('2')
    expect(requireOwnerDocumentFormVersion(secondTab)).toBe('1')
  })

  it('缺失页面实例版本时拒绝猜测服务端最新版本', () => {
    expect(() => requireOwnerDocumentFormVersion({ id: 'report-323' })).toThrow('重新读取')
  })

  it('新建命令成功后由服务端结果初始化当前页面版本', () => {
    const draft = { id: 'change-created-323' }
    initializeOwnerDocumentFormVersion(draft, '1')
    expect(requireOwnerDocumentFormVersion(draft)).toBe('1')
  })

  it('同一可编辑阶段冲突后保留本页业务内容但改用刚读回的服务器版本', () => {
    const local = withOwnerDocumentFormVersion({
      id: 'change-323',
      name: '本页修改',
      note: '保留',
      status: 'rejected',
      sourceId: 'source-old',
      sourceLocked: false,
    }, '1')
    const latest = withOwnerDocumentFormVersion({
      id: 'change-323',
      name: '服务器名称',
      status: 'draft',
      sourceId: 'source-latest',
      sourceLocked: true,
    }, '2')

    const rebased = rebaseOwnerDocumentFormVersion(local, latest)

    expect(rebased).toMatchObject({
      id: 'change-323',
      name: '本页修改',
      note: '保留',
      status: 'draft',
      sourceId: 'source-latest',
      sourceLocked: true,
    })
    expect(requireOwnerDocumentFormVersion(rebased)).toBe('2')
  })

  it('服务器已进入受保护阶段时拒绝把旧业务明细带入新生命周期', () => {
    const local = withOwnerDocumentFormVersion({
      id: 'report-323',
      status: 'draft',
      note: '本页未提交说明',
      lines: [{ boqLineId: 'boq-old', reportedQty: 9 }],
    }, '1')
    const latest = withOwnerDocumentFormVersion({
      id: 'report-323',
      status: 'reported',
      note: '中央已提交说明',
      lines: [{ boqLineId: 'boq-latest', reportedQty: 3 }],
    }, '2')

    const rebased = rebaseOwnerDocumentFormVersion(local, latest)

    expect(rebased).toMatchObject({
      status: 'reported',
      note: '中央已提交说明',
      lines: [{ boqLineId: 'boq-latest', reportedQty: 3 }],
    })
    expect(requireOwnerDocumentFormVersion(rebased)).toBe('2')
  })

  it('已申报报量在同一生命周期的附件冲突后保留本页审定量', () => {
    const local = withOwnerDocumentFormVersion({
      id: 'report-323',
      status: 'reported',
      lines: [{ boqLineId: 'boq-323', reportedQty: 3, auditedQty: 2 }],
    }, '1')
    const latest = withOwnerDocumentFormVersion({
      id: 'report-323',
      status: 'reported',
      sourceLocked: false,
      lines: [{ boqLineId: 'boq-323', reportedQty: 3, auditedQty: null }],
    }, '2')

    expect(ownerDocumentFormCanRebase(local, latest)).toBe(true)
    expect(rebaseOwnerDocumentFormVersion(local, latest)).toMatchObject({
      status: 'reported',
      sourceLocked: false,
      lines: [{ boqLineId: 'boq-323', reportedQty: 3, auditedQty: 2 }],
      _centralBaseVersion: '2',
    })
  })
})
