import type { ProjectSupplierFileReaderPorts } from '../../server/utils/project-supplier-file-reader'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createProjectSupplierFileReader } from '../../server/utils/project-supplier-file-reader'

const query = {
  projectId: 'project-438',
  supplierId: 'supplier-438',
  relationId: 'relation-438',
  fileId: 'file-438',
  ownerType: 'project_supplier',
  ownerId: 'relation-438',
  origin: 'real' as const,
  includeDemo: false,
}
const file = {
  file: { state: 'resolved' as const, entity: 'file' as const, id: query.fileId, label: '中央合作原件.txt', no: null },
  ownerType: query.ownerType,
  ownerId: query.ownerId,
  sourceLabel: '合作档案',
  navigation: { kind: 'unavailable' as const, reason: 'missing-route' as const },
  fileSize: 6,
  mimeType: 'text/plain',
  category: '其他',
  uploader: 'other-uploader',
  uploadedAt: '2026-09-10T00:00:00.000Z',
}
const session = { workspaceId: 'current-workspace', actorId: 'current-reader', capabilities: ['project-supplier:read'] }

function fixture() {
  const readAncestors = vi.fn(async () => 'current-ancestors:1')
  const readWorkbench = vi.fn<ProjectSupplierFileReaderPorts['readWorkbench']>(async () => ({
    dataOrigin: 'real' as const,
    project: { id: query.projectId },
    supplier: { id: query.supplierId },
    relation: { id: query.relationId },
    files: [file],
    sourceVersion: 'files:1',
    capabilities: ['project-supplier:read'],
  }))
  const readPayload = vi.fn<ProjectSupplierFileReaderPorts['readPayload']>(() => ({ payloadBase64: Buffer.from('原件').toString('base64'), sha256: null }))
  return { readAncestors, readWorkbench, readPayload }
}

describe('项目合作原件中央服务', () => {
  it('当前祖先及 owner 验证后才从同会话读取原始字节，读取人可不同于上传人', async () => {
    const ports = fixture()
    const reader = createProjectSupplierFileReader(ports)
    const result = await reader.getContent(query, session, 'session-438')
    expect(result).toMatchObject({
      state: 'available',
      dataOrigin: 'real',
      fileId: query.fileId,
      payloadBase64: Buffer.from('原件').toString('base64'),
      sha256: createHash('sha256').update('原件').digest('hex'),
      sourceVersion: 'current-ancestors:1:files:1',
    })
    expect(ports.readAncestors).toHaveBeenCalledWith(query, 'session-438')
    expect(ports.readPayload).toHaveBeenCalledWith(query.fileId, query.origin, 'session-438')
    expect(ports.readAncestors.mock.invocationCallOrder[0]).toBeLessThan(ports.readPayload.mock.invocationCallOrder[0]!)
  })

  it.each([
    { request: query, capabilities: [] },
    { request: { ...query, origin: 'demo' as const, includeDemo: true }, capabilities: ['project-supplier:read'] },
    { request: { ...query, origin: 'demo' as const }, capabilities: ['project-supplier:read', 'demo:read'] },
  ])('无会话权限或来源授权时不读取祖先和正文：%j', async ({ request, capabilities }) => {
    const ports = fixture()
    await expect(createProjectSupplierFileReader(ports).getContent(request, { ...session, capabilities }))
      .rejects
      .toMatchObject({ problem: { code: 'forbidden' } })
    expect(ports.readAncestors).not.toHaveBeenCalled()
    expect(ports.readPayload).not.toHaveBeenCalled()
  })

  it.each(['forbidden', 'not-found', 'unavailable'])('当前祖先 %s 时不使用导入时快照读取正文', async (code) => {
    const ports = fixture()
    const cause = { problem: { code } }
    ports.readAncestors.mockRejectedValueOnce(cause)
    await expect(createProjectSupplierFileReader(ports).getContent(query, session)).rejects.toBe(cause)
    expect(ports.readWorkbench).not.toHaveBeenCalled()
    expect(ports.readPayload).not.toHaveBeenCalled()
  })

  it.each(['dataOrigin', 'project', 'supplier', 'relation', 'capabilities', 'files'] as const)('当前关系的 %s 变化时不读取正文', async (field) => {
    const ports = fixture()
    const current = await ports.readWorkbench(query)
    const changes = {
      dataOrigin: { dataOrigin: 'demo' as const },
      project: { project: { id: 'other' } },
      supplier: { supplier: { id: 'other' } },
      relation: { relation: { id: 'other' } },
      capabilities: { capabilities: [] },
      files: { files: [] },
    }
    ports.readWorkbench.mockResolvedValue({ ...current, ...changes[field] })
    await expect(createProjectSupplierFileReader(ports).getContent(query, session)).rejects.toMatchObject({
      problem: { code: field === 'capabilities' ? 'forbidden' : field === 'files' ? 'not-found' : 'relationship-mismatch' },
    })
    expect(ports.readPayload).not.toHaveBeenCalled()
  })

  it.each([{ ownerType: 'invoice' }, { ownerId: 'other-relation' }])('拒绝伪造文件 owner：%j', async (change) => {
    const ports = fixture()
    await expect(createProjectSupplierFileReader(ports).getContent({ ...query, ...change }, session))
      .rejects
      .toMatchObject({ problem: { code: 'relationship-mismatch' } })
    expect(ports.readPayload).not.toHaveBeenCalled()
  })

  it('其他业务 owner 明确尚未接入，即使中央恰有同文件 ID 正文也不读取', async () => {
    const ports = fixture()
    ports.readWorkbench.mockResolvedValue({ ...await ports.readWorkbench(query), files: [{ ...file, ownerType: 'invoice', ownerId: 'invoice-438' }] })
    const result = await createProjectSupplierFileReader(ports).getContent({ ...query, ownerType: 'invoice', ownerId: 'invoice-438' }, session)
    expect(result).toMatchObject({ state: 'missing', reason: 'not-connected' })
    expect(result).not.toHaveProperty('payloadBase64')
    expect(ports.readPayload).not.toHaveBeenCalled()
  })

  it('中央明确缺正文只返回缺失，不伪造空正文', async () => {
    const ports = fixture()
    ports.readPayload.mockReturnValue(null)
    const result = await createProjectSupplierFileReader(ports).getContent(query, session)
    expect(result).toMatchObject({ state: 'missing', reason: 'missing-payload' })
    expect(result).not.toHaveProperty('payloadBase64')
  })

  it.each([
    { payloadBase64: 'bad base64', sha256: null },
    { payloadBase64: Buffer.from('截断').toString('base64').slice(4), sha256: null },
    { payloadBase64: Buffer.from('原件').toString('base64'), sha256: '0'.repeat(64) },
  ])('损坏正文、长度和摘要不泄露部分数据：%j', async (payload) => {
    const ports = fixture()
    ports.readPayload.mockReturnValue(payload)
    await expect(createProjectSupplierFileReader(ports).getContent(query, session))
      .rejects
      .toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('重复下载重新核验当前祖先，权限撤回后不复用首次成功正文', async () => {
    const ports = fixture()
    const reader = createProjectSupplierFileReader(ports)
    await reader.getContent(query, session)
    ports.readAncestors.mockRejectedValueOnce({ problem: { code: 'forbidden' } })
    await expect(reader.getContent(query, session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(ports.readAncestors).toHaveBeenCalledTimes(2)
    expect(ports.readPayload).toHaveBeenCalledOnce()
  })
})
