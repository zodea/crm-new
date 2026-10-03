import type { CustomerListItemDTO, CustomerReadRepository } from '~/lib/customer/read-contract'
import type { ProjectCommandRequestDTO } from '~/lib/project/command-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportRowRejected, useImportRunner } from '~/composables/useImportRunner'
import { customerProblem, CustomerRepositoryProblem } from '~/lib/customer/repository'
import { IMPORT_SOURCE_META_KEY } from '~/lib/kit/import-mapping'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'
import { projectDraftFromImport, resolveImportCustomer } from '~/lib/project/import'
import { createProjectRowImporter } from '~/lib/project/import-command'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'
import { useProjectCommandStore } from '~/stores/project-command'
import { parseProjectCommandRequest } from '../../server/utils/project-command-request'
import { createProjectCommandTestInstance } from '../../server/utils/project-command-test-instance'

function customer(id: string, label: string, aliases: string[] = []): CustomerListItemDTO {
  return { dataOrigin: 'real', customer: { id, label, entity: 'customer', state: 'resolved', no: null }, aliases } as CustomerListItemDTO
}
const context = { workspaceId: 'import-423', actorId: 'actor-423', capabilities: ['project:write', 'project:list:read', 'customer:list:read'] }
function sourceRow(overrides: Record<string, unknown> = {}, source: Record<string, unknown> = {}) {
  return Object.defineProperty({ name: '项目423', customerName: 'customer-423', manager: '经理423', status: '施工中', ...overrides }, IMPORT_SOURCE_META_KEY, { value: {
    fileName: '合成423.xlsx',
    fileDigest: 'a'.repeat(64),
    sheetName: 'Sheet423',
    rowNumber: 4,
    externalRef: '',
    rawSnapshot: { 原始名称: '项目423' },
    ...source,
  } })
}
function harness() {
  let sequence = 0
  const customers = [customer('customer-423', '甲方423', ['简称423'])]
  const list = vi.fn<CustomerReadRepository['list']>(async query => ({
    items: customers.slice((query.page - 1) * 100, query.page * 100),
    pagination: { total: customers.length },
  } as Awaited<ReturnType<CustomerReadRepository['list']>>))
  const customerRead = { list } as unknown as CustomerReadRepository
  const commands = createProjectCommandTestInstance({ createId: () => `project-${++sequence}`, validateImportCustomers: async (draft) => {
    for (const id of [draft.customerId, draft.secondaryCustomerId].filter(Boolean)) {
      if (customers.filter(item => item.dataOrigin === 'real' && item.customer.id === id).length !== 1)
        throw new ProjectRepositoryProblem(projectProblem('validation-failed', '客户身份已失效'))
    }
  } })
  const fetcher = vi.fn(async (url: string, options?: { body?: Record<string, unknown> }) => {
    if (url === '/api/read/business-session')
      return context
    if (url === '/api/commands/projects')
      return commands.execute(parseProjectCommandRequest(options!.body), context)
    const id = /^\/api\/read\/projects\/([^/]+)\/form$/.exec(url)?.[1]
    if (id)
      return commands.form(id, context)
    throw new Error(`Unexpected URL: ${url}`)
  })
  const repository = createHttpProjectCommandRepository({ fetcher })
  return { customers, customerRead, list, commands, repository, fetcher, importer: createProjectRowImporter(repository, customerRead) }
}
afterEach(() => vi.unstubAllGlobals())

describe('项目中央逐行导入命令', () => {
  async function createResolveImportCustomerFixture() {
    const h = harness()
    h.customers.unshift(...Array.from({ length: 102 }, (_, index) => customer(`before-${index}`, `客户${index}`)))
    const request = await h.importer.prepare(sourceRow({ customerName: '简称423' }))
    expect(h.list).toHaveBeenCalledTimes(2)
    expect(request.draft.customerId).toBe('customer-423')
    h.customers.push(customer('second', '甲方423'))
    return { h, request }
  }

  it('完整分页解析唯一 ID/名称/别名，重复同名必须用稳定 ID，不采用演示候选', async () => {
    const { h } = await createResolveImportCustomerFixture()
    expect(projectDraftFromImport(sourceRow({ status: '旧阶段' }), h.customers).status).toBe('筹备中')
  })

  it.each([
    { case: '缺项目经理', patch: { manager: '' }, customers: 'original', expected: '项目经理' },
    { case: '非 ISO 日期', patch: { startDate: '2026/09/09' }, customers: 'original', expected: 'ISO 日期' },
    { case: '停用客户', patch: { customerName: 'inactive-423' }, customers: 'inactive', expected: '已停用' },
    { case: '停用次客户', patch: { secondaryCustomerName: 'inactive-423' }, customers: 'both', expected: '次客户“停用客户”已停用' },
  ])('导入草稿拒绝 $case', ({ patch, customers, expected }) => {
    const h = harness()
    const inactive = { ...customer('inactive-423', '停用客户'), status: 'inactive' }
    const lookup = customers === 'inactive' ? [inactive] : customers === 'both' ? [...h.customers, inactive] : h.customers
    expect(() => projectDraftFromImport(sourceRow(patch), lookup)).toThrow(expected)
  })

  it.each([
    { case: '\'customer-423\' / h.customers / \'客户\'', prepare: async ({ h }: Awaited<ReturnType<typeof createResolveImportCustomerFixture>>) => {
      return { input: 'customer-423', argument2: h.customers, argument3: '客户', expected: 'customer-423' } as const
    } },
    { case: '\'other-status\' / [{ ...customer(\'other-status\', \'其他状态\'), status: \'legacy-unknown\' }] / \'客户\'', prepare: async (_fixture: Awaited<ReturnType<typeof createResolveImportCustomerFixture>>) => {
      return { input: 'other-status', argument2: [{ ...customer('other-status', '其他状态'), status: 'legacy-unknown' }], argument3: '客户', expected: 'other-status' } as const
    } },
  ])('完整分页解析唯一 ID/名称/别名，重复同名必须用稳定 ID，不采用演示候选 / resolveImportCustomer：$case', async ({ prepare }) => {
    const fixture = await createResolveImportCustomerFixture()
    const { input, argument2, argument3, expected } = await prepare(fixture)
    expect(resolveImportCustomer(input, argument2, argument3)).toBe(expected)
  })

  it.each([
    { case: '\'甲方423\' / h.customers / \'客户\'', prepare: async ({ h }: Awaited<ReturnType<typeof createResolveImportCustomerFixture>>) => {
      return { input: '甲方423', argument2: h.customers, argument3: '客户', expected: '歧义' } as const
    } },
    { case: '\'demo\' / [{ ...customer(\'demo\', \'测试客户\'), dataOrigin: \'demo\' }] / \'客户\'', prepare: async (_fixture: Awaited<ReturnType<typeof createResolveImportCustomerFixture>>) => {
      return { input: 'demo', argument2: [{ ...customer('demo', '测试客户'), dataOrigin: 'demo' }], argument3: '客户', expected: '正式可读范围' } as const
    } },
  ])('完整分页解析唯一 ID/名称/别名，重复同名必须用稳定 ID，不采用演示候选 / resolveImportCustomer：$case', async ({ prepare }) => {
    const fixture = await createResolveImportCustomerFixture()
    const { input, argument2, argument3, expected } = await prepare(fixture)
    expect(() => resolveImportCustomer(input, argument2, argument3)).toThrow(expected)
  })

  it('相同来源并发/重传及外部旧 ID 重试返回同一项目，修改内容明确冲突', async () => {
    const h = harness()
    const source = { externalRef: 'EXT-423' }
    const [first, second] = await Promise.all([h.importer.importRow(sourceRow({}, source)), h.importer.importRow(sourceRow({}, source))])
    expect(first.id).toBe(second.id)
    const reuploaded = await createProjectRowImporter(h.repository, h.customerRead).importRow(sourceRow({}, { ...source, fileDigest: 'b'.repeat(64) }))
    expect(reuploaded.id).toBe(first.id)
    await expect(h.importer.importRow(sourceRow({ name: '不能覆盖' }, source))).rejects.toThrow('内容不同')
    expect(h.commands.rows()).toHaveLength(1)
    expect(h.commands.form(first.id, context)).toMatchObject({ draft: { name: '项目423', customerId: 'customer-423', approvalStatus: 'draft' }, importSource: { externalRef: 'EXT-423', rowNumber: 4, rawSnapshot: { 原始名称: '项目423' } } })
  })

  it('预览固定关系 ID；名称变化仍用原 ID，删除或无权时按行拒绝，客户读取故障可重试', async () => {
    const h = harness()
    const row = sourceRow({ customerName: '简称423' })
    await h.importer.prepare(row)
    h.customers[0] = customer('customer-423', '客户改名')
    expect((await h.importer.importRow(row)).id).toBe('project-1')
    const invalidated = sourceRow({}, { rowNumber: 5 })
    await h.importer.prepare(invalidated)
    h.customers.splice(0)
    await expect(h.importer.importRow(invalidated)).rejects.toBeInstanceOf(ImportRowRejected)
    expect(h.commands.rows()).toHaveLength(1)
    h.list.mockRejectedValueOnce(new CustomerRepositoryProblem(customerProblem('forbidden', '无客户查看权限')))
    await expect(h.importer.validate(sourceRow())).resolves.toBe('无客户查看权限')
    h.list.mockRejectedValueOnce(new CustomerRepositoryProblem(customerProblem('unavailable', '中央客户读取失败', true)))
    await expect(h.importer.validate(sourceRow())).rejects.toThrow('中央客户读取失败')
  })

  it('写入响应丢失/回读失败后固定命令重试，不重建成功行且不影响表单草稿会话', async () => {
    const h = harness()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() {
        return values.size
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { projectCommands: h.repository, customerRead: h.customerRead } }))
    setActivePinia(createPinia())
    const store = useProjectCommandStore()
    const execute = h.repository.execute
    const write = vi.spyOn(h.repository, 'execute').mockRejectedValueOnce(new Error('离线'))
    const session = store.createSession()
    await store.hydrate(session, null)
    await expect(store.saveForm(session, { name: '另一个编辑页的草稿' }, 'draft')).rejects.toThrow('仅保留本地草稿')
    const before = [...values]
    write.mockImplementationOnce(async (request) => {
      await execute(request)
      throw new Error('响应丢失')
    }).mockImplementation(execute)
    const row = sourceRow()
    await expect(store.importRow(row)).rejects.toThrow('响应丢失')
    vi.spyOn(h.repository, 'loadForm').mockRejectedValueOnce(new Error('回读失败'))
    await expect(store.importRow(row)).rejects.toThrow('回读失败')
    await expect(store.importRow(row)).resolves.toMatchObject({ id: 'project-1' })
    expect([...values]).toEqual(before)
    expect(h.commands.rows()).toHaveLength(1)
    const importCalls = write.mock.calls.filter(([request]) => request.importSource)
    expect(new Set(importCalls.map(([request]) => request.commandId)).size).toBe(1)
    await store.saveForm(session, { name: '另一个编辑页的草稿' }, 'draft')
    expect(write.mock.calls.at(-1)![0]).toMatchObject({ commandId: JSON.parse(before[0]![1]).commandId, baseVersion: null })
    expect(write.mock.calls.at(-1)![0]).not.toHaveProperty('id')
    expect(h.commands.rows()).toHaveLength(2)
  })

  async function createParseProjectCommandRequestFixture() {
    const h = harness()
    const request = await h.importer.prepare(sourceRow())
    await expect(h.commands.execute({ ...request, actorId: 'spoof' }, context)).rejects.toThrow('操作人')
    await expect(h.commands.execute(request, { ...context, capabilities: [] })).rejects.toThrow('写入权限')
    return { h, request }
  }

  it('中央信封拒绝伪造身份、导入编辑目标和未知来源字段格式', async () => {
    const { h, request } = await createParseProjectCommandRequestFixture()
    await expect(h.commands.execute({ ...request, action: 'submit' } as ProjectCommandRequestDTO, context)).rejects.toThrow('只能新建')
    expect(h.commands.rows()).toHaveLength(0)
  })

  it.each([
    { case: '{ ...request, id: \'overwrite\' } / \'overwrite\'', prepare: async ({ request }: Awaited<ReturnType<typeof createParseProjectCommandRequestFixture>>) => {
      return { input: { ...request, id: 'overwrite' }, argument2: 'overwrite', expected: '只能新建' } as const
    } },
    { case: '{ ...request, importSource: { ...request.importSource, rowNumber: -1 } }', prepare: async ({ request }: Awaited<ReturnType<typeof createParseProjectCommandRequestFixture>>) => {
      return { input: { ...request, importSource: { ...request.importSource, rowNumber: -1 } }, argument2: undefined, expected: '来源信息无效' } as const
    } },
  ])('中央信封拒绝伪造身份、导入编辑目标和未知来源字段格式 / parseProjectCommandRequest：$case', async ({ prepare }) => {
    const fixture = await createParseProjectCommandRequestFixture()
    const { input, argument2, expected } = await prepare(fixture)
    expect(() => parseProjectCommandRequest(input, argument2)).toThrow(expected)
  })

  it('提交期业务拒绝继续下一行，取消阻止尚未执行的剩余行', async () => {
    const runner = useImportRunner({ yieldToView: async () => {} })
    const rows = [sourceRow(), sourceRow({}, { rowNumber: 5 }), sourceRow({}, { rowNumber: 6 })]
    const sink = vi.fn().mockRejectedValueOnce(new ImportRowRejected('客户已失效')).mockImplementationOnce(async () => runner.cancel())
    expect(await runner.start(rows, sink)).toEqual({ status: 'cancelled' })
    expect(sink).toHaveBeenCalledTimes(2)
    expect(runner.rejected.value).toMatchObject([{ index: 0, reason: '客户已失效' }])
  })
})
