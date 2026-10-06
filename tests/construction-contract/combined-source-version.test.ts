import { describe, expect, it } from 'vitest'
import { prepareConstructionContractChainIdentityFixtures } from '../../server/utils/construction-contract-chain-test-fixture'
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
    const first = read.list({ origin: 'real' })
    ownerVersion = 'owner-v2'
    const second = read.list({ origin: 'real' })

    expect(first.sourceVersion).not.toBe(second.sourceVersion)
    expect(first.meta.sources).toContainEqual(expect.objectContaining({ key: 'owner-commercial-documents', state: 'readable', sourceVersion: 'owner-v1' }))
    expect(second.meta.sources).toContainEqual(expect.objectContaining({ key: 'owner-commercial-documents', state: 'readable', sourceVersion: 'owner-v2' }))
  })

  it('把同一 canonical 验收记录同步为施工合同的验收与保修双事实入口', () => {
    const sessionId = 'construction-owner-acceptance-324'
    constructionContractCommandTestInstance.reset(sessionId)
    prepareConstructionContractChainIdentityFixtures(sessionId)
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

  it('把 canonical 最终结算及其补充协议、收款事实同步回施工合同来源链', () => {
    const sessionId = 'construction-owner-final-settlement-325'
    constructionContractCommandTestInstance.reset(sessionId)
    prepareConstructionContractChainIdentityFixtures(sessionId)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], sessionId)
    try {
      const read = createConstructionContractReadTestInstance(
        () => ['construction-contract:read'],
        constructionContractCommandTestInstance,
        {
          rows: () => structuredClone(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS),
          sourceVersion: () => 'owner-final-settlement-325',
        },
      )
      const rows = structuredClone(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS)
      const settlement = rows.find(row => row.kind === 'final_settlement')!
      settlement.finalSettlementEvidence?.supplements?.push({
        id: 'supplement-draft-cn-325',
        no: 'BC-DRAFT-CN-325',
        name: '中文草稿补充协议',
        status: '草稿',
        amount: 200000,
        date: '2026-08-20',
      })
      const filteredRead = createConstructionContractReadTestInstance(
        () => ['construction-contract:read'],
        constructionContractCommandTestInstance,
        {
          rows: () => rows,
          sourceVersion: () => 'owner-final-settlement-filter-325',
        },
      )
      const filteredDetail = filteredRead.detail(CONSTRUCTION_CONTRACT_EXISTING_ID, { origin: 'real' }, sessionId)
      const detail = read.detail(CONSTRUCTION_CONTRACT_EXISTING_ID, { origin: 'real' }, sessionId)

      expect(detail.sections.settlements.finalSettlements[0]?.navigation).toMatchObject({
        subject: { entity: 'owner-document', id: 'final-settlement-real-325' },
        variant: 'final-settlement',
      })
      expect(detail.sections.supplements).toContainEqual(expect.objectContaining({
        id: 'supplement-real-325',
        navigation: expect.objectContaining({ variant: 'supplement', view: 'supplement-real-325' }),
      }))
      expect(detail.sections.receipts).toContainEqual(expect.objectContaining({
        id: 'receipt-real-325',
        navigation: expect.objectContaining({
          subject: expect.objectContaining({ entity: 'receipt', id: 'receipt-real-325' }),
        }),
      }))
      expect(filteredDetail.sections.supplements.map(row => row.id)).not.toContain('supplement-draft-cn-325')
    }
    finally {
      constructionContractCommandTestInstance.reset(sessionId)
    }
  })

  it('把 canonical 甲方罚扣同步为施工合同中的专属只读入口', () => {
    const sessionId = 'construction-owner-penalty-326'
    constructionContractCommandTestInstance.reset(sessionId)
    prepareConstructionContractChainIdentityFixtures(sessionId)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], sessionId)
    try {
      const read = createConstructionContractReadTestInstance(
        () => ['construction-contract:read'],
        constructionContractCommandTestInstance,
        {
          rows: () => structuredClone(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS),
          sourceVersion: () => 'owner-penalty-326',
        },
      )
      const detail = read.detail(CONSTRUCTION_CONTRACT_EXISTING_ID, { origin: 'real' }, sessionId)

      expect(detail.sections.settlements.penalties).toEqual([
        expect.objectContaining({
          id: 'owner-penalty-real-326',
          no: 'FK-2026-326',
          navigation: expect.objectContaining({
            subject: {
              state: 'resolved',
              entity: 'owner-document',
              id: 'owner-penalty-real-326',
              label: '施工进度延误',
              no: 'FK-2026-326',
            },
            variant: 'penalty',
          }),
        }),
      ])
    }
    finally {
      constructionContractCommandTestInstance.reset(sessionId)
    }
  })
})

it('累计结算只纳入同来源非草稿月报；最终结算不重复相加，未接开票保持未知', () => {
  const scope = 'construction-settled-real-facts'
  constructionContractCommandTestInstance.reset(scope)
  prepareConstructionContractChainIdentityFixtures(scope)
  constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], scope)
  try {
    const report = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.find(row => row.kind === 'owner_report')!
    if (!report)
      throw new Error('真实月报fixture缺失')
    let rows: import('../../app/lib/owner-document/central-repository').OwnerCommercialDocumentSource[] = [{ ...report, id: 'monthly-first', status: 'submitted', amount: 125.5, contractId: CONSTRUCTION_CONTRACT_EXISTING_ID }, { ...report, id: 'monthly-draft', status: 'draft', amount: 99999, contractId: CONSTRUCTION_CONTRACT_EXISTING_ID }, { ...report, id: 'final-independent', kind: 'final_settlement' as const, status: 'submitted', amount: 800, contractId: CONSTRUCTION_CONTRACT_EXISTING_ID }]
    const owner = { rows: () => rows, sourceVersion: () => JSON.stringify(rows) }
    const read = createConstructionContractReadTestInstance(() => ['construction-contract:read'], constructionContractCommandTestInstance, owner)
    const detail = () => read.detail(CONSTRUCTION_CONTRACT_EXISTING_ID, { origin: 'real' }, scope)
    expect(detail().contract.amounts).toMatchObject({ settled: '125.50', invoiced: null, invoicedUnreceived: null })
    expect(detail().meta.sources).toContainEqual({ key: 'invoice-applications', state: 'unavailable', sourceVersion: null, asOf: null })
    rows = [{ ...rows[0]!, amount: null }]
    expect(detail().contract.amounts.settled).toBeNull()
    rows = []
    expect(detail().contract.amounts.settled).toBe('0.00')
    expect(detail().contract.amounts.invoiced).toBeNull()
  }
  finally { constructionContractCommandTestInstance.reset(scope) }
})
