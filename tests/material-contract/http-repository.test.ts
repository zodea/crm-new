import { describe, expect, it, vi } from 'vitest'
import { createHttpMaterialContractCommandRepository } from '~/lib/material-contract/command-http-repository'
import { createHttpMaterialContractReadRepository } from '~/lib/material-contract/http-repository'
import { decodeMaterialContractDetailRead, decodeMaterialContractListPage } from '~/lib/material-contract/read-decoder'
import {
  parseMaterialContractListQuery,
} from '~/lib/material-contract/repository'
import { createMaterialContractReadTestInstance } from '../../server/utils/material-contract-read-test-instance'
import { buildMaterialContractListPage, materialOriginMeta } from '../helpers/material-read-meta'

describe('材料采购合同中央 HTTP Repository', () => {
  it('约定价使用固定只读路由、当前来源和取消信号，拒绝跨来源响应与演示越权', async () => {
    const owner = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
    const response = owner.prices('demo')
    const fetcher = vi.fn().mockResolvedValue(response)
    const repository = createHttpMaterialContractReadRepository({ fetcher })
    const controller = new AbortController()
    const prices = await repository.prices!('demo', { signal: controller.signal })
    expect(fetcher).toHaveBeenCalledWith('/api/read/material-contracts/prices', { query: { origin: 'demo' }, signal: controller.signal })
    expect(prices.items.every(row => row.dataOrigin === 'demo' && row.applicableTaxRate === null)).toBe(true)
    expect(prices.meta.dataOrigin).toBe('demo')
    await expect(repository.prices!('real')).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    const denied = createMaterialContractReadTestInstance(() => ['material-contract:read'])
    expect(() => denied.prices('demo')).toThrow('无测试合同')
  })

  it('结构合法的响应仍必须匹配本次分页和详情目标', async () => {
    const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
    const repository = createHttpMaterialContractReadRepository({ fetcher: vi.fn().mockResolvedValue(read.list({ page: '1', pageSize: '10' })) })
    await expect(repository.list(parseMaterialContractListQuery({ page: '2' }))).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    await expect(repository.list(parseMaterialContractListQuery({ pageSize: '20' }))).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
    const details = createHttpMaterialContractReadRepository({ fetcher: vi.fn().mockResolvedValue(detail) })
    await expect(details.get({ id: 'another-contract', origin: 'demo', includeDemo: true })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(details.get({ id: 'con_demo_cg01', origin: 'real', includeDemo: false })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  })
  it('公共读取强制现行 metadata，拒绝旧契约、混身份来源和伪造扁平版本', () => {
    const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
    const page = read.list({ includeDemo: 'true' })
    expect(page.meta).toMatchObject({ schemaVersion: 'material-contract-read-v2', dataOrigin: 'real' })
    expect(page.originMeta.demo.dataOrigin).toBe('demo')
    expect(page.originMeta.demo.sourceVersion).not.toBe(page.originMeta.real.sourceVersion)
    for (const mutate of [
      (value: any) => { delete value.meta },
      (value: any) => { value.meta.schemaVersion = 'material-contract-read-v1' },
      (value: any) => { value.originMeta.demo.actorId = 'another-actor' },
      (value: any) => { value.sourceVersion = 'stale-flat-version' },
      (value: any) => { value.originMeta.demo.sources[0].state = 'forbidden' },
    ]) {
      const invalid = structuredClone(page)
      mutate(invalid)
      expect(() => decodeMaterialContractListPage(invalid)).toThrow()
    }
    const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
    const invalid = structuredClone(detail)
    invalid.meta.dataOrigin = 'real'
    expect(() => decodeMaterialContractDetailRead(invalid)).toThrow()
  })
  it.each([401, 403])('真实 HTTP %s 即使损坏 Problem 正文也保留身份错误，不降为网络暂不可用', async (status) => {
    const read = createHttpMaterialContractReadRepository({ fetcher: vi.fn().mockRejectedValue({ response: { status, _data: { data: { code: 'unavailable', fieldErrors: { name: '错误类型' } } } } }) })
    await expect(read.list(parseMaterialContractListQuery({}))).rejects.toMatchObject({ problem: { code: status === 401 ? 'unauthenticated' : 'forbidden', retryable: false } })
    const commands = createHttpMaterialContractCommandRepository({ fetcher: vi.fn().mockRejectedValue({ response: { status, _data: '坏正文' } }) })
    await expect(commands.context()).rejects.toMatchObject({ problem: { code: status === 401 ? 'unauthenticated' : 'forbidden' } })
  })
  it('序列化列表查询并解码中央响应', async () => {
    const page = buildMaterialContractListPage({
      contracts: [],
      query: parseMaterialContractListQuery({ page: '2', pageSize: '20' }),
      originMeta: materialOriginMeta(['material-contract:read'], 'v1'),
    })
    const fetcher = vi.fn().mockResolvedValue(page)
    const repository = createHttpMaterialContractReadRepository({ fetcher })

    await repository.list(parseMaterialContractListQuery({
      includeDemo: 'true',
      search: '瓷砖',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      status: '履约中',
      page: '2',
      pageSize: '20',
    }))

    expect(fetcher).toHaveBeenCalledWith('/api/read/material-contracts', {
      query: {
        includeDemo: 'true',
        origin: '',
        search: '瓷砖',
        projectId: 'project-1',
        supplierId: 'supplier-1',
        status: '履约中',
        page: '2',
        pageSize: '20',
      },
    })
  })

  function createMaterialContractNavigationReads() {
    const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read', 'project:list:read', 'supplier:list:read'])
    const page = read.list({ includeDemo: 'true' })
    const invalidPage = structuredClone(page)
    const navigation = invalidPage.items[0]!.navigation
    if (navigation.kind !== 'entity-detail')
      throw new Error('测试夹具缺少合同详情意图')
    navigation.subject = { ...navigation.subject, id: 'wrong-contract-id' }
    return { read, page, invalidPage, navigation }
  }

  it.each([
    { case: 'invalidPage', prepare: ({ invalidPage }: ReturnType<typeof createMaterialContractNavigationReads>) => {
      return { input: invalidPage, expected: /列表读模型无效/ } as const
    } },
    { case: 'invalidRowKey', prepare: ({ page, read }: ReturnType<typeof createMaterialContractNavigationReads>) => {
      const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
      const invalidDetail = structuredClone(detail)
      if (invalidDetail.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidDetail.projectNavigation.filters.dataOrigin = 'real'
      const invalidRowKey = structuredClone(page)
      invalidRowKey.items[0]!.rowKey = 'demo:wrong-id'
      return { input: invalidRowKey, expected: /列表读模型无效/ } as const
    } },
  ])('拒绝 subject、来源或关系不一致的嵌套导航 DTO / decodeMaterialContractListPage：$case', ({ prepare }) => {
    const fixture = createMaterialContractNavigationReads()
    const { input, expected } = prepare(fixture)
    expect(() => decodeMaterialContractListPage(input)).toThrowError(expected)
  })

  it.each([
    { case: 'invalidDetail', prepare: ({ read }: ReturnType<typeof createMaterialContractNavigationReads>) => {
      const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
      const invalidDetail = structuredClone(detail)
      if (invalidDetail.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidDetail.projectNavigation.filters.dataOrigin = 'real'
      return { input: invalidDetail, expected: /详情读模型无效/ } as const
    } },
    { case: 'invalidVariant', prepare: ({ read, page }: ReturnType<typeof createMaterialContractNavigationReads>) => {
      const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
      const invalidDetail = structuredClone(detail)
      if (invalidDetail.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidDetail.projectNavigation.filters.dataOrigin = 'real'
      const invalidRowKey = structuredClone(page)
      invalidRowKey.items[0]!.rowKey = 'demo:wrong-id'
      const invalidVariant = structuredClone(detail)
      if (invalidVariant.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidVariant.projectNavigation.variant = 'edit'
      return { input: invalidVariant, expected: /详情读模型无效/ } as const
    } },
    { case: 'invalidTaxRate', prepare: ({ read, page }: ReturnType<typeof createMaterialContractNavigationReads>) => {
      const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
      const invalidDetail = structuredClone(detail)
      if (invalidDetail.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidDetail.projectNavigation.filters.dataOrigin = 'real'
      const invalidRowKey = structuredClone(page)
      invalidRowKey.items[0]!.rowKey = 'demo:wrong-id'
      const invalidVariant = structuredClone(detail)
      if (invalidVariant.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidVariant.projectNavigation.variant = 'edit'
      const invalidTaxRate = structuredClone(detail)
      invalidTaxRate.contract.taxRate = 'not-a-number' as never
      return { input: invalidTaxRate, expected: /详情读模型无效/ } as const
    } },
    { case: 'invalidRatio', prepare: ({ read, page }: ReturnType<typeof createMaterialContractNavigationReads>) => {
      const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
      const invalidDetail = structuredClone(detail)
      if (invalidDetail.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidDetail.projectNavigation.filters.dataOrigin = 'real'
      const invalidRowKey = structuredClone(page)
      invalidRowKey.items[0]!.rowKey = 'demo:wrong-id'
      const invalidVariant = structuredClone(detail)
      if (invalidVariant.projectNavigation.kind !== 'entity-detail')
        throw new Error('测试夹具缺少项目详情意图')
      invalidVariant.projectNavigation.variant = 'edit'
      const invalidTaxRate = structuredClone(detail)
      invalidTaxRate.contract.taxRate = 'not-a-number' as never
      const invalidRatio = structuredClone(detail)
      invalidRatio.contract.retentionRatio = 0.03 as never
      return { input: invalidRatio, expected: /详情读模型无效/ } as const
    } },
  ])('拒绝 subject、来源或关系不一致的嵌套导航 DTO / decodeMaterialContractDetailRead：$case', ({ prepare }) => {
    const fixture = createMaterialContractNavigationReads()
    const { input, expected } = prepare(fixture)
    expect(() => decodeMaterialContractDetailRead(input)).toThrowError(expected)
  })

  it('历史原件明确未知上传时间可读，错误日期仍拒绝且不把未知补成时间', async () => {
    const attachment = { id: 'historical-original', ownerType: 'contract', ownerId: 'contract-1', fileName: '旧原件.pdf', filePath: '', fileSize: 0, mimeType: 'application/pdf', category: '', uploader: '', uploadedAt: null, deletedAt: null }
    const response = { draft: { id: 'contract-1', name: '历史原合同' }, attachments: [attachment], version: '1', updatedAt: '2026-10-07T00:00:00.000Z' }
    const repository = createHttpMaterialContractCommandRepository({ fetcher: vi.fn().mockResolvedValue(response) })
    expect((await repository.loadForm('contract-1')).attachments).toEqual([attachment])
    for (const uploadedAt of ['', '不是日期', '2026-99-99T00:00:00Z']) {
      const invalid = createHttpMaterialContractCommandRepository({ fetcher: vi.fn().mockResolvedValue({ ...response, attachments: [{ ...attachment, uploadedAt }] }) })
      await expect(invalid.loadForm('contract-1')).rejects.toThrow('表单无效')
    }
  })

  it('拒绝畸形中央表单 draft 与附件', async () => {
    const valid = {
      draft: {
        id: 'contract-1',
        name: '材料采购合同',
        lineItems: [{ id: 'line-1', materialName: '瓷砖', qty: 1 }],
      },
      attachments: [],
      version: '1',
      updatedAt: '2026-08-24T00:00:00.000Z',
    }
    const malformedDraft = createHttpMaterialContractCommandRepository({
      fetcher: vi.fn().mockResolvedValue({
        ...valid,
        draft: { ...valid.draft, lineItems: [{ ...valid.draft.lineItems[0], qty: '1' }] },
      }),
    })
    await expect(malformedDraft.loadForm('contract-1')).rejects.toThrowError(/表单无效/)

    const malformedAttachment = createHttpMaterialContractCommandRepository({
      fetcher: vi.fn().mockResolvedValue({
        ...valid,
        attachments: [{ id: 'file-1', ownerType: 'project' }],
      }),
    })
    await expect(malformedAttachment.loadForm('contract-1')).rejects.toThrowError(/表单无效/)
  })
})
