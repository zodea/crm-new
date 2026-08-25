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
