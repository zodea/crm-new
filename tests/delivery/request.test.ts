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
  it.each([
    { case: '缺值', amount: null },
    { case: '明确零', amount: 0 },
  ])('归档保留$case', ({ amount }) => {
    const body = { ...valid, draft: { ...valid.draft, lines: [{ ...valid.draft.lines[0], unitPrice: amount, amount }] } }
    expect(parseDeliveryCommand(body)).toEqual(body)
  })

  it('打印命令保留目标身份、版本和打印状态', () => {
    const body = { action: 'print', commandId: 'print', workspaceId: 'workspace', actorId: 'actor', requiredCapability: 'delivery:write', origin: 'real', targets: [{ id: 'record', baseVersion: '1' }], disposition: 'printed' }
    expect(parseDeliveryCommand(body)).toEqual(body)
  })

  it.each([
    { name: '草稿伪造原件身份', body: { ...valid, draft: { ...valid.draft, assetId: 'other-owner' } } },
    { name: '工地原文不是文本', body: { ...valid, draft: { ...valid.draft, rawSiteText: 1 } } },
    { name: '数量是字符串', body: { ...valid, draft: { ...valid.draft, lines: [{ ...valid.draft.lines[0], qty: '1' }] } } },
    { name: '待补价格确认不是布尔值', body: { ...valid, draft: { ...valid.draft, confirmations: { pricePendingConfirmed: 'yes' } } } },
    { name: '上传伪造原件身份', body: { ...valid, source: { id: 'forged-asset', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 1, payloadBase64: 'YQ==' } } },
    { name: '来源为演示数据', body: { ...valid, origin: 'demo' } },
    { name: '声明只读权限', body: { ...valid, requiredCapability: 'delivery:read' } },
    { name: '修订命令携带原件字段', body: { ...valid, action: 'revise', id: 'record', baseVersion: '1', reason: '修正', source: null } },
  ])('$name：在进入命令服务前被拒绝', ({ body }) => {
    expect(() => parseDeliveryCommand(body)).toThrow('送货命令或字段格式无效，请重新核对')
  })
})
