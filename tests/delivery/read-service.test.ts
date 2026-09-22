import type { DeliveryArchiveCommand } from '~/lib/delivery-record/contract'
import { describe, expect, it } from 'vitest'
import { createDeliveryCommandService } from '../../server/utils/delivery-command-service'
import { createDeliveryReadService } from '../../server/utils/delivery-read-service'

const session = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['delivery:read', 'delivery:write', 'project:list:read', 'supplier:list:read', 'demo:read'] }
const command: DeliveryArchiveCommand = {
  action: 'archive',
  commandId: 'command',
  workspaceId: 'workspace',
  actorId: 'actor',
  requiredCapability: 'delivery:write',
  origin: 'real',
  baseVersion: null,
  uploadBatchId: null,
  source: { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 14, payloadBase64: btoa('%PDF-1.7\n%%EOF') },
  draft: { projectId: 'p', supplierId: 's', orderNo: 'DH', deliveryDate: '2026-09-11', note: '', rawSiteText: '', reviewFlag: '', confirmations: {}, lines: [{ materialName: '材料', spec: '', unit: '吨', qty: 1, unitPrice: 1, amount: 1, note: '' }] },
}
function setup() {
  let currentSession = session
  let next = 0
  const commands = createDeliveryCommandService({ createId: () => `read-${++next}`, references: () => ({ projects: [{ id: 'p', name: '正式项目', dataOrigin: 'real' }], suppliers: [{ id: 's', name: '正式分供方', dataOrigin: 'real' }] }) })
  const result = commands.execute(command, session, 'one')
  const record = commands.detail(result.id, session, 'one')
  const read = createDeliveryReadService(commands, () => currentSession)
  return { read, record, setSession: (value: typeof session) => currentSession = value }
}

describe('送货 HTTP 读入口服务', () => {
  it('按当前祖先和正式来源返回记录、历史与完整原件身份', () => {
    const { read, record } = setup()
    expect(read.list({ origin: 'real' }, 'one').records[0]?.id).toBe(record.id)
    expect(read.detail(record.id, { origin: 'real' }, 'one').projectName).toBe('正式项目')
    expect(read.history(record.id, { origin: 'real' }, 'one')).toHaveLength(1)
    expect(read.fileContent(record.id, record.assetId!, { origin: 'real', projectId: 'p', supplierId: 's' }, 'one')).toMatchObject({ ownerType: 'delivery_record', recordId: record.id, projectId: 'p', supplierId: 's', sourceVersion: '1', payloadBase64: command.source!.payloadBase64 })
  })

  it('演示必须显式开启且有当前权限，绝不借用正式同 ID 或另一测试会话', () => {
    const { read, record, setSession } = setup()
    expect(() => read.list({ origin: 'demo' }, 'one')).toThrow('演示')
    expect(read.list({ origin: 'demo', includeDemo: 'true' }, 'one').records).toEqual([])
    expect(() => read.detail(record.id, { origin: 'demo', includeDemo: 'true' }, 'one')).toThrow('不存在')
    expect(() => read.detail(record.id, { origin: 'real' }, 'two')).toThrow('不存在')
    setSession({ ...session, capabilities: session.capabilities.filter(cap => cap !== 'demo:read') })
    expect(() => read.list({ origin: 'demo', includeDemo: 'true' }, 'one')).toThrow('权限')
  })

  it('请求关系不匹配和非法 query 不泄露正文，撤销项目权限不冒充空列表', () => {
    const { read, record, setSession } = setup()
    expect(() => read.fileContent(record.id, record.assetId!, { origin: 'real', projectId: 'other', supplierId: 's' }, 'one')).toThrow('归属')
    expect(() => read.list({ origin: ['real', 'demo'] }, 'one')).toThrow('参数')
    setSession({ ...session, capabilities: session.capabilities.filter(cap => cap !== 'project:list:read') })
    expect(() => read.list({ origin: 'real' }, 'one')).toThrow('权限')
    setSession({ ...session, capabilities: session.capabilities.filter(cap => cap !== 'supplier:list:read') })
    expect(() => read.list({ origin: 'real' }, 'one')).toThrow('权限')
  })
})
