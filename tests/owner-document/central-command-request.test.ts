import { describe, expect, it } from 'vitest'
import { parseOwnerCommercialDocumentCommandRequest } from '../../server/utils/owner-commercial-document-command-request'

const envelope = {
  workspaceId: 'workspace-323',
  actorId: 'actor-323',
  requiredCapability: 'owner-document:write',
  commandId: 'command-323',
  kind: 'owner_report',
  id: null,
  baseVersion: null,
}

describe('甲方商务单据 HTTP 命令解析', () => {
  it('只接受带分包单据权限的分包变洽签保存命令', () => {
    const request = parseOwnerCommercialDocumentCommandRequest({
      ...envelope,
      requiredCapability: 'subcontract-document:write',
      kind: 'sub_change',
      action: 'submit',
      draft: {
        projectId: 'project-327',
        supplierId: 'supplier-327',
        contractId: 'subcontract-327',
        changeDate: '2026-08-27',
        approvedAmount: 38000,
        reason: '样板层劳务范围调整',
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    })

    expect(request).toMatchObject({
      requiredCapability: 'subcontract-document:write',
      kind: 'sub_change',
      action: 'submit',
      draft: { supplierId: 'supplier-327', contractId: 'subcontract-327' },
    })
    expect(() => parseOwnerCommercialDocumentCommandRequest({
      ...request,
      requiredCapability: 'owner-document:write',
    })).toThrow('命令请求无效')
  })

  it('接受甲方罚扣保存命令并保留专属有限字段', () => {
    const request = parseOwnerCommercialDocumentCommandRequest({
      ...envelope,
      kind: 'owner_penalty',
      action: 'submit',
      draft: {
        projectId: 'project-real-320',
        contractId: 'construction-contract-existing-320',
        noticeNo: 'LX-2026-326',
        amount: 36000,
        penaltyDate: '2026-08-26',
        reason: '施工进度延误',
        appealNote: '已提交工期顺延说明',
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    })

    expect(request).toMatchObject({
      kind: 'owner_penalty',
      action: 'submit',
      draft: { noticeNo: 'LX-2026-326', amount: 36000, reason: '施工进度延误' },
    })
  })

  it('接受最终结算保存命令的有限字段', () => {
    const request = parseOwnerCommercialDocumentCommandRequest({
      ...envelope,
      kind: 'final_settlement',
      action: 'save',
      draft: {
        projectId: 'project-real-320',
        contractId: 'construction-contract-existing-320',
        settlementAmount: 1280000,
        auditedAmount: null,
        settlementBasis: '施工合同与已确认补充协议',
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    })

    expect(request).toMatchObject({
      kind: 'final_settlement',
      action: 'save',
      draft: { settlementAmount: 1280000, auditedAmount: null },
    })
  })

  it('拒绝畸形 draft 行和附件嵌套对象', () => {
    expect(() => parseOwnerCommercialDocumentCommandRequest({
      ...envelope,
      action: 'save',
      draft: { lines: [{ boqLineId: { nested: true } }] },
      attachments: { add: [] },
    })).toThrow('保存命令无效')
    expect(() => parseOwnerCommercialDocumentCommandRequest({
      ...envelope,
      action: 'save',
      draft: {},
      attachments: { add: [{ fileName: '依据.pdf', payload: { nested: true } }] },
    })).toThrow('保存命令无效')
  })

  it('审定命令只接受稳定 BOQ 行 ID 与有限数值', () => {
    expect(() => parseOwnerCommercialDocumentCommandRequest({
      ...envelope,
      id: 'report-323',
      action: 'audit',
      audit: { lines: [{ boqLineId: 'boq-323', auditedQty: Number.NaN }] },
    })).toThrow('审定命令无效')
  })
})
