import { describe, expect, it } from 'vitest'
import { constructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { createConstructionContractReadTestInstance } from '../../server/utils/construction-contract-read-test-instance'

describe('施工合同聚合读取版本', () => {
  it('甲方变洽签或月报事实变化时推进合同详情的组合 sourceVersion', () => {
    let ownerVersion = 'owner-v1'
    const ownerDocuments = {
      rows: () => [],
      sourceVersion: () => ownerVersion,
    }
    const read = createConstructionContractReadTestInstance(
      () => ['construction-contract:read'],
      constructionContractCommandTestInstance,
      ownerDocuments,
    )
    const first = read.list({ origin: 'real' }).sourceVersion
    ownerVersion = 'owner-v2'
    const second = read.list({ origin: 'real' }).sourceVersion

    expect(first).not.toBe(second)
    expect(second).toContain('owner-v2')
  })
})
