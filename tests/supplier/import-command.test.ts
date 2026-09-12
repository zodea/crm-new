import type { BusinessSession } from '../../server/utils/business-session'
import type { SupplierHttpFetcher } from '~/lib/supplier/http-repository'
import { describe, expect, it, vi } from 'vitest'
import { getImportEntity } from '~/lib/kit/import-entities'
import { autoMatchColumns, buildImportRows } from '~/lib/kit/import-mapping'
import { SUPPLIER_WRITE_CAPABILITY } from '~/lib/supplier/command-contract'
import { createHttpSupplierCommandRepository } from '~/lib/supplier/command-http-repository'
import { createSupplierRowImporter } from '~/lib/supplier/import-command'
import { parseSupplierImportCommandRequest } from '../../server/utils/supplier-command-request'
import { createSupplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'
import { createSupplierReadTestInstance } from '../../server/utils/supplier-read-test-instance'

const session: BusinessSession = {
  workspaceId: 'import-workspace',
  actorId: 'import-actor',
  capabilities: ['supplier:list:read', SUPPLIER_WRITE_CAPABILITY],
}

function harness() {
  let sequence = 0
  const commands = createSupplierCommandTestInstance({ createId: () => `import-${++sequence}` })
  const reads = createSupplierReadTestInstance(() => session.capabilities, id => commands.rows(id), id => commands.sourceVersion(id))
  const fetcher = vi.fn<SupplierHttpFetcher>(async (url, options) => {
    if (url === '/api/read/business-session')
      return session
    if (url === '/api/commands/suppliers/import')
      return commands.importRow(parseSupplierImportCommandRequest(options?.body), session)
    const id = /^\/api\/read\/suppliers\/([^/]+)\/form$/.exec(url)?.[1]
    if (id)
      return commands.form(decodeURIComponent(id), session)
    throw new Error(`Unexpected URL: ${url}`)
  })
  const repository = createHttpSupplierCommandRepository({ fetcher })
  return { commands, reads, repository, fetcher, importRow: createSupplierRowImporter(repository) }
}

describe('分供方中央逐行导入', () => {
  it('按真实模板分开识别内部编码、信用代码和劳务范围，中央列表与表单均能回读', async () => {
    const h = harness()
    const source = {
      公司全称: '中央导入分供方',
      唯一识别码: 'SUP-100',
      统一社会信用代码: '91440000IMPORT100',
      主营业务: '建筑施工',
      劳务承包范围: '石材安装\n楼梯铺贴',
      经营类型: '有限责任公司',
      匹配标识: 'HQ-100',
    }
    const mapping = autoMatchColumns(Object.keys(source), getImportEntity('supplier')!.fields)
    expect(mapping.uniqueCode?.column).toBe('唯一识别码')
    expect(mapping.taxNo?.column).toBe('统一社会信用代码')
    expect(mapping.businessType?.column).toBe('经营类型')
    await h.importRow(buildImportRows(mapping, [source])[0]!)
    const page = await h.reads.list({ search: '楼梯铺贴' })
    expect(page.items).toEqual([expect.objectContaining({
      supplier: expect.objectContaining({ id: 'import-1', label: '中央导入分供方' }),
      mainBusiness: '建筑施工',
      laborScope: '石材安装\n楼梯铺贴',
      credentialStatus: 'incomplete',
    })])
    expect(h.commands.form('import-1', session).draft).toMatchObject({
      uniqueCode: 'SUP-100',
      taxNo: '91440000IMPORT100',
      externalRef: 'HQ-100',
      businessType: '有限责任公司',
      supplierCategory: '其他',
    })
    expect(h.fetcher).toHaveBeenCalledWith('/api/commands/suppliers/import', expect.objectContaining({ method: 'POST' }))
    expect(h.fetcher).toHaveBeenCalledWith('/api/read/suppliers/import-1/form')
  })

  it('按外部旧 ID 重导只更新映射字段，保留省略值并允许明确清空劳务范围', async () => {
    const h = harness()
    await h.importRow({ name: '原始分供方', externalRef: 'HQ-PATCH', mainBusiness: '主营业务', laborScope: '安装范围', contact: '旧联系人', taxNo: 'TAX-PATCH', bank: '开户行' })
    const imported = { ...h.commands.rows()[0]!, id: 'reviewed', externalRef: 'HQ-REVIEWED', taxNo: 'TAX-REVIEWED', credentialStatus: 'qualified' }
    h.commands.prepareImportedSuppliers([imported]).commit()
    await h.importRow({ name: '原始分供方', externalRef: 'HQ-REVIEWED', contact: '新联系人' })
    expect(h.commands.form('reviewed', session).draft).toMatchObject({ mainBusiness: '主营业务', laborScope: '安装范围', bank: '开户行', contact: '新联系人' })
    await h.importRow({ name: '原始分供方', externalRef: 'HQ-REVIEWED', laborScope: '' })
    // 旧导入标签没有人工凭证与原件；有效人工结论的非关键编辑保留由 credential-central 完整旅程验证。
    expect(h.commands.rows().find(row => row.id === 'reviewed')).toMatchObject({ laborScope: '', mainBusiness: '主营业务', credentialStatus: 'incomplete' })
    expect(h.commands.rows()).toHaveLength(2)
    await h.importRow({ name: '更改工商名称', externalRef: 'HQ-REVIEWED' })
    expect(h.commands.rows().find(row => row.id === 'reviewed')?.credentialStatus).toBe('incomplete')
  })

  it('写入响应丢失或回读失败时重试同一行沿用命令 ID，不重复创建无旧 ID 的记录', async () => {
    const h = harness()
    const execute = h.repository.importRow
    const write = vi.spyOn(h.repository, 'importRow')
      .mockImplementationOnce(async (request) => {
        await execute(request)
        throw new Error('响应丢失')
      })
      .mockImplementation(execute)
    const row = { name: '没有旧 ID 的分供方' }
    await expect(h.importRow(row)).rejects.toThrow('响应丢失')
    const load = vi.spyOn(h.repository, 'loadForm').mockRejectedValueOnce(new Error('回读失败'))
    await expect(h.importRow(row)).rejects.toThrow('回读失败')
    await expect(h.importRow(row)).resolves.toMatchObject({ id: 'import-1', version: '1' })
    expect(h.commands.rows()).toHaveLength(1)
    expect(new Set(write.mock.calls.map(([request]) => request.commandId)).size).toBe(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('没有写权限时不发送导入命令，服务端也拒绝身份和权限伪造', async () => {
    const h = harness()
    vi.spyOn(h.repository, 'context').mockResolvedValue({ ...session, capabilities: ['supplier:list:read'] })
    await expect(h.importRow({ name: '不可导入' })).rejects.toThrow('无分供方导入权限')
    expect(h.fetcher).not.toHaveBeenCalled()
    const request = parseSupplierImportCommandRequest({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: SUPPLIER_WRITE_CAPABILITY, commandId: 'forbidden', draft: { name: '不可导入' } })
    await expect(h.commands.importRow(request, { ...session, capabilities: [] })).rejects.toThrow('无分供方写入权限')
    await expect(h.commands.importRow({ ...request, actorId: 'other-actor' }, session)).rejects.toThrow('请求身份与当前会话不匹配')
    expect(h.commands.rows()).toEqual([])
  })

  it('匹配标识不唯一或身份代码冲突时拒绝，不任意覆盖记录', async () => {
    const h = harness()
    await h.importRow({ name: '原始分供方', externalRef: 'HQ-DUP', uniqueCode: 'CODE-DUP', taxNo: 'TAX-DUP' })
    await expect(h.importRow({ name: '第二分供方', uniqueCode: 'CODE-DUP' })).rejects.toThrow('分供方内部编码已存在')
    await expect(h.importRow({ name: '第三分供方', taxNo: 'TAX-DUP' })).rejects.toThrow('统一社会信用代码已存在')
    const duplicate = { ...h.commands.rows()[0]!, id: 'duplicate-ref', uniqueCode: '', taxNo: '' }
    h.commands.prepareImportedSuppliers([duplicate]).commit()
    await expect(h.importRow({ name: '不应覆盖', externalRef: 'HQ-DUP' })).rejects.toThrow('外部旧 ID 对应多个分供方')
    expect(h.commands.rows().map(row => row.name)).toEqual(['原始分供方', '原始分供方'])
  })

  it('hTTP 导入边界拒绝主档 ID、核验结论与畸形字段；空名称生成行级拒绝', async () => {
    const envelope = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: SUPPLIER_WRITE_CAPABILITY, commandId: 'invalid' }
    for (const extra of [{ id: 'other' }, { credentialStatus: 'qualified' }, { approvalStatus: 'approved' }, { taxpayerVerificationStatus: 'verified' }, { laborScope: [] }]) {
      expect(() => parseSupplierImportCommandRequest({ ...envelope, draft: { name: '拒绝伪造', ...extra } })).toThrow()
    }
    await expect(getImportEntity('supplier')!.validateRow!({ name: ' ' })).resolves.toBe('公司全称不能为空')
  })
})
