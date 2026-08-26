import { describe, expect, it } from 'vitest'
import {
  CONSTRUCTION_CONTRACT_EXISTING_ID,
  CONSTRUCTION_CONTRACT_EXISTING_RECORD,
  constructionContractCommandTestInstance,
} from '../../server/utils/construction-contract-command-test-instance'
import { createConstructionContractReadTestInstance } from '../../server/utils/construction-contract-read-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from '../../server/utils/owner-commercial-document-fixtures'

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

  it('把同一 canonical 验收记录同步为施工合同的验收与保修双事实入口', () => {
    const sessionId = 'construction-owner-acceptance-324'
    constructionContractCommandTestInstance.reset(sessionId)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], sessionId)
    try {
      const read = createConstructionContractReadTestInstance(
        () => ['construction-contract:read'],
        constructionContractCommandTestInstance,
        {
          rows: () => structuredClone(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS),
          sourceVersion: () => 'owner-acceptance-324',
        },
      )
      const detail = read.detail(CONSTRUCTION_CONTRACT_EXISTING_ID, { origin: 'real' }, sessionId)

      expect(detail.sections.acceptance.acceptances[0]?.navigation).toMatchObject({
        subject: { id: 'acceptance-real-324' },
        variant: 'acceptance',
      })
      expect(detail.sections.acceptance.warranties[0]?.navigation).toMatchObject({
        subject: { id: 'acceptance-real-324' },
        variant: 'warranty',
      })
    }
    finally {
      constructionContractCommandTestInstance.reset(sessionId)
    }
  })
})
