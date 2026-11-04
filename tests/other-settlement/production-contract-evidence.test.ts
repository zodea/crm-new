import { afterAll, describe, expect, it } from 'vitest'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createProductionOtherSettlementService, listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'
import { cleanupTestTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

describe('正式结算合同来源证据', () => {
  it('新结算经原命令、合同 owner 和关系核验，仅暴露当前可信领域与版本', async () => {
    const f = await createSubcontractFixture()
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'auxiliary-contract:read', 'auxiliary-contract:write', 'other-settlement:read', 'other-settlement:write', 'finance-reimbursement:read', 'finance-payment-application:read', 'finance-payment-record:read'] })
    const auxiliary = createProductionAuxiliaryContractService(f.storage)
    const settlements = createProductionOtherSettlementService(f.storage)
    try {
      const actor = f.session()
      const contractRequest = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'evidence-contract-create', baseVersion: null, action: 'submit' as const, constructionMain: f.constructionMain, attachments: {}, draft: { kind: 'other_expense' as const, no: 'EVIDENCE-OTHER', name: '合成其他支出', category: '检测服务', projectId: f.project.id, supplierId: f.supplier.id, signDate: '2026-10-07', amount: 100, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }
      const contract = await auxiliary.execute(contractRequest, f.session)
      const draft = { name: '合成合同结算', no: 'EVIDENCE-SETTLEMENT', projectId: f.project.id, contractId: contract.id, supplierId: f.supplier.id, totalAmount: 20, taxRate: null, settlementDate: '2026-10-07' }
      const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'other-settlement:write', commandId: 'evidence-settlement-submit', baseVersion: null, action: 'submit' as const, attachments: {}, draft }
      const saved = await settlements.execute(request, f.session)
      const confirmed = await settlements.execute({ ...request, id: saved.id, baseVersion: saved.version, commandId: 'evidence-settlement-confirm', action: 'confirm' }, f.session)
      const read = () => f.storage.withTransaction(tx => readProductionOtherSettlementReference(tx, f.session(), saved.id))
      const before = await read()
      expect(before?.contractEvidence).toMatchObject({ state: 'resolved', settlementId: saved.id, settlementVersion: confirmed.version, domain: 'auxiliary', kind: 'other_expense', id: contract.id, version: contract.version, projectId: f.project.id, projectVersion: f.project.version, projectSourceVersion: expect.stringMatching(/^projects:\d+$/), supplierId: f.supplier.id, supplierVersion: f.supplier.version, supplierSourceVersion: expect.stringMatching(/^suppliers:\d+$/), sourceVersion: expect.stringMatching(/^auxiliary-contract-\d+$/) })
      const source = await auxiliary.detail(contract.id, { kind: 'other_expense' }, f.session)
      const updated = await auxiliary.execute({ ...contractRequest, id: contract.id, baseVersion: contract.version, commandId: 'evidence-contract-update', action: 'save', constructionMain: undefined, draft: { ...source.contract.draft, name: '来源的新名称' } }, f.session)
      const after = await read()
      expect(after?.contractEvidence).toMatchObject({ state: 'resolved', settlementId: saved.id, settlementVersion: confirmed.version, id: contract.id, version: updated.version })
      expect(after?.contractEvidence).not.toEqual(before?.contractEvidence)
      const restricted = { ...f.session(), capabilities: f.session().capabilities.filter(value => value !== 'auxiliary-contract:read') }
      const rows = await f.storage.withTransaction(tx => listProductionOtherSettlementReferences(tx, restricted))
      expect(rows.find(row => row.id === saved.id)?.contractEvidence).toMatchObject({ state: 'forbidden', settlementId: saved.id, settlementVersion: confirmed.version })
      await f.storage.withTransaction(async (tx) => {
        await tx.execute('UPDATE production_participants SET schema_version=99 WHERE domain=\'supplier\'')
        const withoutSource = await listProductionOtherSettlementReferences(tx, f.session())
        expect(withoutSource.find(row => row.id === saved.id)?.contractEvidence).toMatchObject({ state: 'unavailable', settlementId: saved.id, settlementVersion: confirmed.version })
        await tx.execute('UPDATE production_participants SET schema_version=1 WHERE domain=\'supplier\'')
      })
    }
    finally { await f.storage.close() }
  })

  it('历史裸合同 ID 不推断领域；明确无合同保留 none', async () => {
    const f = await createSubcontractFixture()
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'other-settlement:read', 'auxiliary-contract:read'] })
    try {
      await f.storage.execute(`INSERT INTO expenditure_settlements(id,name,project_id,supplier_id,contract_id,status,version,record_json) VALUES
        ('legacy-contract','旧合同结算',?,?,?,'draft',0,NULL),
        ('legacy-no-contract','旧无合同结算',NULL,NULL,NULL,'draft',0,NULL)`, [f.project.id, f.supplier.id, 'same-legacy-id'])
      const rows = await f.storage.withTransaction(tx => listProductionOtherSettlementReferences(tx, f.session()))
      expect(rows.find(row => row.id === 'legacy-contract')?.contractEvidence).toMatchObject({ state: 'unavailable', settlementId: 'legacy-contract', settlementVersion: '0' })
      expect(rows.find(row => row.id === 'legacy-no-contract')?.contractEvidence).toEqual({ state: 'none', settlementId: 'legacy-no-contract', settlementVersion: '0' })
    }
    finally { await f.storage.close() }
  })
})
