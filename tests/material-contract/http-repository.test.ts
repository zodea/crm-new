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
        search: '瓷砖',
        projectId: 'project-1',
        supplierId: 'supplier-1',
        status: '履约中',
        page: '2',
        pageSize: '20',
      },
    })
  })

  it('拒绝 subject、来源或关系不一致的嵌套导航 DTO', () => {
    const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
    const page = read.list({ includeDemo: 'true' })
    const invalidPage = structuredClone(page)
    const navigation = invalidPage.items[0]!.navigation
    if (navigation.kind !== 'entity-detail')
      throw new Error('测试夹具缺少合同详情意图')
    navigation.subject = { ...navigation.subject, id: 'wrong-contract-id' }
    expect(() => decodeMaterialContractListPage(invalidPage)).toThrowError(/列表读模型无效/)

    const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
    const invalidDetail = structuredClone(detail)
    if (invalidDetail.projectNavigation.kind !== 'entity-detail')
      throw new Error('测试夹具缺少项目详情意图')
    invalidDetail.projectNavigation.filters.dataOrigin = 'real'
    expect(() => decodeMaterialContractDetailRead(invalidDetail)).toThrowError(/详情读模型无效/)

    const invalidRowKey = structuredClone(page)
    invalidRowKey.items[0]!.rowKey = 'demo:wrong-id'
    expect(() => decodeMaterialContractListPage(invalidRowKey)).toThrowError(/列表读模型无效/)

    const invalidVariant = structuredClone(detail)
    if (invalidVariant.projectNavigation.kind !== 'entity-detail')
      throw new Error('测试夹具缺少项目详情意图')
    invalidVariant.projectNavigation.variant = 'edit'
    expect(() => decodeMaterialContractDetailRead(invalidVariant)).toThrowError(/详情读模型无效/)

    const invalidTaxRate = structuredClone(detail)
    invalidTaxRate.contract.taxRate = 'not-a-number' as never
    expect(() => decodeMaterialContractDetailRead(invalidTaxRate)).toThrowError(/详情读模型无效/)

    const invalidRatio = structuredClone(detail)
    invalidRatio.contract.retentionRatio = 0.03 as never
    expect(() => decodeMaterialContractDetailRead(invalidRatio)).toThrowError(/详情读模型无效/)
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
