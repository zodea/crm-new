import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createLocalBackup, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { productionFinanceOwners } from '../../server/utils/production-finance-runtime'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { validatePaymentSettlementEvidence } from '../../server/utils/production-finance-settlement-evidence'
import { createProductionOtherSettlementService } from '../../server/utils/production-other-settlement-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { expectFinanceEvidenceDamageRejected } from '../helpers/finance-evidence-corruption'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

it('正式结算的可信合同领域和来源版本在付款申请中冻结，失权与跨域不能采用', async () => {
  const f = await createSubcontractFixture()
  try {
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'auxiliary-contract:read', 'auxiliary-contract:write', 'other-settlement:read', 'other-settlement:write', 'finance-reimbursement:read', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'finance-payment-record:write', 'finance-invoice:read'] })
    const actor = f.session()
    const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
    const auxiliary = createProductionAuxiliaryContractService(f.storage)
    const contract = await auxiliary.execute({ ...identity, requiredCapability: 'auxiliary-contract:write', commandId: 'payment-proof-contract', baseVersion: null, action: 'submit', constructionMain: f.constructionMain, attachments: {}, draft: { kind: 'other_expense', no: 'SYN-PROOF', name: '合成支出合同', category: '检测服务', projectId: f.project.id, supplierId: f.supplier.id, signDate: '2026-10-07', amount: 100, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    const settlements = createProductionOtherSettlementService(f.storage)
    const settlementRequest = { ...identity, requiredCapability: 'other-settlement:write', commandId: 'payment-proof-settlement', baseVersion: null, action: 'submit', attachments: {}, draft: { name: '合成结算', no: 'SYN-SETTLEMENT', projectId: f.project.id, contractId: contract.id, supplierId: f.supplier.id, totalAmount: 20, taxRate: null, settlementDate: '2026-10-07' } }
    const settlement = await settlements.execute(settlementRequest, f.session)
    const confirmed = await settlements.execute({ ...settlementRequest, id: settlement.id, baseVersion: settlement.version, commandId: 'payment-proof-confirm-settlement', action: 'confirm' }, f.session)
    const finance = createProductionFinanceService(f.storage, { references: productionFinanceOwners })
    const reference = { domain: 'auxiliary', id: contract.id, version: contract.version }
    const lookup = { kind: 'settlements', keyword: '', projectId: f.project.id, supplierId: f.supplier.id, contractId: contract.id, contractDomain: 'auxiliary', contractVersion: contract.version }
    expect((await finance.lookup('payment_application', lookup, f.session)).items).toContainEqual(expect.objectContaining({ id: settlement.id }))
    await expect(finance.lookup('payment_application', { ...lookup, contractDomain: null, contractVersion: null }, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect((await finance.lookup('payment_application', { ...lookup, contractDomain: 'material' }, f.session)).items).toEqual([])
    const application = { ...identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'save', commandId: 'payment-proof-application', baseVersion: null, attachments: {}, draft: { name: '合成付款申请', bizType: '有合同-其他', projectId: f.project.id, supplierId: f.supplier.id, contractId: contract.id, contractReference: reference, applyAmount: 20, applyDate: '2026-10-07', applicant: '合成人', invoiceState: '无需发票', settlementAllocations: [{ settlementId: settlement.id, allocatedAmount: 20 }] } }
    const falseNoContract = { ...application, commandId: 'payment-proof-false-no-contract', draft: { ...application.draft, bizType: '项目费用', contractId: null, contractReference: null } }
    await expect(finance.execute(falseNoContract, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(finance.execute(falseNoContract, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(finance.execute({ ...falseNoContract, commandId: 'payment-proof-false-no-contract-forbidden' }, () => ({ ...actor, capabilities: actor.capabilities.filter(capability => capability !== 'auxiliary-contract:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const concurrent = await Promise.allSettled(['a', 'b'].map(suffix => finance.execute({ ...falseNoContract, commandId: `payment-proof-false-no-contract-${suffix}` }, f.session)))
    expect(concurrent).toHaveLength(2)
    expect(concurrent.every(result => result.status === 'rejected' && result.reason.problem?.code === 'validation-failed')).toBe(true)
    expect(await f.storage.select('SELECT id FROM payment_applications WHERE name=?', ['合成付款申请'])).toEqual([])
    await expect(finance.execute(application, () => ({ ...actor, capabilities: actor.capabilities.filter(capability => capability !== 'auxiliary-contract:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(finance.execute({ ...application, commandId: 'payment-proof-wrong-domain', draft: { ...application.draft, contractReference: { ...reference, domain: 'material' } } }, f.session)).rejects.toMatchObject({ problem: { code: expect.stringMatching(/validation-failed|unavailable|forbidden/) } })
    const saved = await finance.execute(application, f.session)
    expect(saved.paymentSettlementEvidenceSha256).toMatch(/^[a-f0-9]{64}$/)
    const [history] = await f.storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=? AND id=? AND version=?', ['payment_application', saved.id, Number(saved.version)])
    const frozen = JSON.parse(history!.snapshot_json)
    expect(frozen.paymentSettlementEvidence).toMatchObject([{ state: 'resolved', domain: 'auxiliary', id: contract.id, version: contract.version, settlementId: settlement.id, settlementVersion: confirmed.version, projectId: f.project.id, supplierId: f.supplier.id, projectVersion: f.project.version, supplierVersion: f.supplier.version }])
    await expectFinanceEvidenceDamageRejected(f.storage, actor, { kind: 'payment_application', id: saved.id, version: saved.version, commandId: saved.commandId, field: 'paymentSettlementEvidence', digest: 'paymentSettlementEvidenceSha256' })
    await expect(validatePaymentSettlementEvidence(f.storage, { ...frozen, paymentSettlementEvidence: [] })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(validatePaymentSettlementEvidence(f.storage, { ...frozen, paymentSettlementEvidence: [{ ...frozen.paymentSettlementEvidence[0], domain: 'material' }] })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await finance.execute(application, f.session)).toEqual(saved)
    const payment = { ...identity, requiredCapability: 'finance-payment-record:write', kind: 'payment_record', action: 'confirm', commandId: 'payment-proof-confirm', baseVersion: null, attachments: {}, draft: { projectId: f.project.id, supplierId: f.supplier.id, payeeName: '合成分供方', amount: 20, paymentDate: '2026-10-07', voucherNo: 'SYN-PROOF-V', bankSerialNo: 'SYN-PROOF-B', confirmedBy: actor.actorId, applicationAllocations: [{ paymentApplicationId: saved.id, allocatedAmount: 20 }] } }
    const paymentResult = await finance.execute(payment, f.session)
    expect(await finance.execute(payment, f.session)).toEqual(paymentResult)
    await expect(validateFinanceJournal(f.storage, f.session())).resolves.toBeDefined()
    const backupDirectory = join(f.options.directory, 'payment-proof-backup')
    const restoreDirectory = join(f.options.directory, 'payment-proof-restore')
    await Promise.all([mkdir(backupDirectory), mkdir(restoreDirectory)])
    const backup = await createLocalBackup(f.storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    const restored = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'payment-proof-restore')
    const recovered = createProductionStorage({ ...f.options, directory: restored.directory })
    try {
      await expect(validateFinanceJournal(recovered, f.session())).resolves.toBeDefined()
      const recoveredFinance = createProductionFinanceService(recovered, { references: productionFinanceOwners })
      expect(await recoveredFinance.execute(application, f.session)).toEqual(saved)
      expect(await recoveredFinance.execute(payment, f.session)).toEqual(paymentResult)
      const [recoveredHistory] = await recovered.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=? AND id=? AND version=?', ['payment_application', saved.id, Number(saved.version)])
      expect(JSON.parse(recoveredHistory!.snapshot_json).paymentSettlementEvidence).toEqual(frozen.paymentSettlementEvidence)
      await recovered.close()
      const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});const history=db.prepare('SELECT snapshot_json FROM finance_history WHERE kind=? AND id=?').get('payment_application',process.argv[2]);const receipt=db.prepare('SELECT result_json FROM finance_commands WHERE command_id=?').get(process.argv[3]);process.stdout.write(JSON.stringify({evidence:JSON.parse(history.snapshot_json).paymentSettlementEvidence,receipt:JSON.parse(receipt.result_json),foreignKeys:db.prepare('PRAGMA foreign_key_check').all()}));db.close()`
      const cold = JSON.parse(execFileSync(process.execPath, ['-e', script, join(restored.directory, 'ruihang.sqlite'), saved.id, payment.commandId], { encoding: 'utf8', windowsHide: true }))
      expect(cold).toEqual({ evidence: frozen.paymentSettlementEvidence, receipt: paymentResult, foreignKeys: [] })
    }
    finally { await recovered.close() }
  }
  finally { await f.storage.close() }
})
