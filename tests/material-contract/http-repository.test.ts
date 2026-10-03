import { describe, expect, it, vi } from 'vitest'
import { createHttpMaterialContractCommandRepository } from '~/lib/material-contract/command-http-repository'
import { createHttpMaterialContractReadRepository } from '~/lib/material-contract/http-repository'
import { decodeMaterialContractDetailRead, decodeMaterialContractListPage } from '~/lib/material-contract/read-decoder'
import {
  buildMaterialContractListPage,
  parseMaterialContractListQuery,
} from '~/lib/material-contract/repository'
import { createMaterialContractReadTestInstance } from '../../server/utils/material-contract-read-test-instance'

describe('材料采购合同中央 HTTP Repository', () => {
  it('序列化列表查询并解码中央响应', async () => {
    const page = buildMaterialContractListPage({
      contracts: [],
      query: parseMaterialContractListQuery({ page: '2', pageSize: '20' }),
      asOf: '2026-08-24T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['material-contract:read'],
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
    const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
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
