import { describe, expect, it } from 'vitest'
import { parseDeliveryCommand } from '../../server/utils/delivery-command-request'

const valid = {
  action: 'archive',
  commandId: 'command',
  workspaceId: 'workspace',
  actorId: 'actor',
  requiredCapability: 'delivery:write',
  origin: 'real',
  baseVersion: null,
  uploadBatchId: null,
  source: null,
  draft: { projectId: 'p', supplierId: 's', orderNo: 'DH', deliveryDate: '2026-09-11', note: '', rawSiteText: '', reviewFlag: '', confirmations: {}, lines: [{ materialName: '材料', spec: '', unit: '吨', qty: 1, unitPrice: null, amount: null, note: '' }] },
}

describe('送货 HTTP 命令解析', () => {
  it('保留缺值和明确零，按动作读取必要字段', () => {
    expect(parseDeliveryCommand(valid)).toEqual(valid)
    const withZero = { ...valid, draft: { ...valid.draft, lines: [{ ...valid.draft.lines[0], unitPrice: 0, amount: 0 }] } }
    expect(parseDeliveryCommand(withZero)).toEqual(withZero)
    expect(parseDeliveryCommand({ action: 'print', commandId: 'print', workspaceId: 'workspace', actorId: 'actor', requiredCapability: 'delivery:write', origin: 'real', targets: [{ id: 'record', baseVersion: '1' }], disposition: 'printed' })).toMatchObject({ targets: [{ id: 'record', baseVersion: '1' }] })
  })

  it.each([
    { ...valid, draft: { ...valid.draft, assetId: 'other-owner' } },
    { ...valid, draft: { ...valid.draft, rawSiteText: 1 } },
    { ...valid, draft: { ...valid.draft, lines: [{ ...valid.draft.lines[0], qty: '1' }] } },
    { ...valid, draft: { ...valid.draft, confirmations: { pricePendingConfirmed: 'yes' } } },
    { ...valid, source: { id: 'forged-asset', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 1, payloadBase64: 'YQ==' } },
    { ...valid, origin: 'demo' },
    { ...valid, requiredCapability: 'delivery:read' },
    { ...valid, action: 'revise', id: 'record', baseVersion: '1', reason: '修正', source: null },
  ])('非法字段在进入命令服务前被拒绝', (body) => {
    expect(() => parseDeliveryCommand(body)).toThrow('格式')
  })
})
