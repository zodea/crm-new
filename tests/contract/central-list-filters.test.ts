import { describe, expect, it } from 'vitest'
import { serializeConstructionContractListQuery } from '~/lib/construction-contract/read-decoder'
import { parseConstructionContractListQuery } from '~/lib/construction-contract/read-page'
import { constructionContractListNavigationStateFromQuery, createConstructionContractReturnOrigin } from '~/lib/construction-contract/return-context'
import { serializeMaterialContractListQuery } from '~/lib/material-contract/read-decoder'
import { parseMaterialContractListQuery } from '~/lib/material-contract/read-page'
import { createMaterialContractReturnOrigin, materialContractListNavigationStateFromQuery } from '~/lib/material-contract/return-context'
import { serializeSubcontractContractListQuery } from '~/lib/subcontract-contract/read-decoder'
import { parseSubcontractContractListQuery } from '~/lib/subcontract-contract/read-page'
import { createSubcontractContractReturnOrigin, subcontractContractListNavigationStateFromQuery } from '~/lib/subcontract-contract/return-context'

describe('合同中央列表固定条件多选', () => {
  const cases = [
    { name: '材料采购', parse: parseMaterialContractListQuery, serialize: serializeMaterialContractListQuery },
    { name: '施工', parse: parseConstructionContractListQuery, serialize: serializeConstructionContractListQuery },
    { name: '分包', parse: parseSubcontractContractListQuery, serialize: serializeSubcontractContractListQuery },
  ] as const

  it.each(cases)('$name 经 HTTP 编解码保留多个状态，兼容旧单选链接', (item) => {
    const query = item.parse({ status: JSON.stringify(['草稿', '履约中', '草稿']), page: 2 })
    expect(query.status).toEqual(['草稿', '履约中'])
    // 三种 DTO 的关联方字段不同，在各自分支内验证同一编解码契约。
    const encoded = item.name === '材料采购'
      ? serializeMaterialContractListQuery(parseMaterialContractListQuery({ ...query }))
      : item.name === '施工'
        ? serializeConstructionContractListQuery(parseConstructionContractListQuery({ ...query }))
        : serializeSubcontractContractListQuery(parseSubcontractContractListQuery({ ...query }))
    expect(item.parse(encoded).status).toEqual(['草稿', '履约中'])
    expect(item.parse({ status: '履约中' }).status).toBe('履约中')
    expect(item.parse({ status: '[]' }).status).toBeNull()
    expect(() => item.parse({ status: '["草稿",1]' })).toThrow()
  })

  it('三个详情返回地址都保留多选状态与分包类型', () => {
    const input = { status: '["草稿","履约中"]', subKind: '["劳务","专业"]', origin: 'real', page: '2' }
    const options = { contextId: 'origin_multi_filter', rowIdentity: 'real:contract-1', scrollTop: 120, now: 0 }
    const origins = [
      createMaterialContractReturnOrigin({ ...options, state: materialContractListNavigationStateFromQuery(input) }),
      createConstructionContractReturnOrigin({ ...options, state: constructionContractListNavigationStateFromQuery(input) }),
      createSubcontractContractReturnOrigin({ ...options, state: subcontractContractListNavigationStateFromQuery(input) }),
    ]
    for (const origin of origins) {
      const query = Object.fromEntries(new URL(origin.returnTo, 'https://crm.invalid').searchParams)
      expect(parseMaterialContractListQuery(query).status).toEqual(['草稿', '履约中'])
      expect(query.page).toBe('2')
    }
    const subQuery = Object.fromEntries(new URL(origins[2]!.returnTo, 'https://crm.invalid').searchParams)
    expect(parseSubcontractContractListQuery(subQuery).subKind).toEqual(['劳务', '专业'])
  })
})
