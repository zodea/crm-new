import { describe, expect, it } from 'vitest'
import { parsePaymentContractReference, paymentContractSelectionKey } from '../../app/lib/finance/payment-contract'
import { isPaymentVerificationEdit, isPaymentVerificationProof, isPaymentVerificationState } from '../../app/lib/finance/payment-verification'

it('保留领域、编号和版本，跨领域相同编号拥有不同选择身份', () => {
  const material = { domain: 'material', id: 'contract-one', version: '1' } as const
  const subcontract = { domain: 'subcontract', id: 'contract-one', version: '2' } as const
  expect(parsePaymentContractReference(material)).toEqual(material)
  expect(parsePaymentContractReference(subcontract)).toEqual(subcontract)
  expect(paymentContractSelectionKey(material)).not.toBe(paymentContractSelectionKey(subcontract))
})

it('拒绝缺失领域、无效版本及不支持的身份字段', () => {
  for (const value of [
    { id: 'contract-one', version: '1' },
    { domain: 'unknown', id: 'contract-one', version: '1' },
    { domain: 'company', id: 'contract-one', version: '0' },
    { domain: 'material', id: 'contract-one', version: 1 },
    { domain: 'material', id: 'contract-one', version: '1', label: '合同' },
  ])
    expect(parsePaymentContractReference(value)).toBeNull()
})

const edit = { actualDueAmount: 70, cumulativePayableAmount: 60, basis: '原费100、已确认结算70、累计批复60已逐项核实', fileIds: ['proof-original'] }
const proof = {
  ...edit,
  schemaVersion: 'payment-verification-v1',
  applicationId: 'old-application',
  applicationVersion: '3',
  commandId: 'verify-original-key',
  workspaceId: 'workspace-one',
  actorId: 'owner-one',
  verifiedAt: '2026-10-05T01:00:00.000Z',
  applicationSnapshotSha256: 'a'.repeat(64),
  sources: [{ owner: 'other-settlements', id: 'source-other', version: '2', sourceVersion: 'other-settlement-record-2', fingerprint: 'b'.repeat(64), evidenceJson: JSON.stringify({ id: 'source-other', version: '2', total_amount: 70, ownerSnapshotSha256: 'd'.repeat(64) }) }],
  originals: [{ id: 'proof-original', ownerType: 'payment_application', ownerId: 'old-application', fileName: '真实依据.bin', fileSize: 4, sha256: 'c'.repeat(64) }],
}
describe('pAY-08 核验显式输入与冻结读取', () => {
  it('累计结论、明确0和实际四字节证据可以表示；本次银行实付不在核验编辑中', () => {
    expect(isPaymentVerificationEdit(edit)).toBe(true)
    expect(isPaymentVerificationEdit({ ...edit, actualDueAmount: 0, cumulativePayableAmount: 0 })).toBe(true)
    expect(isPaymentVerificationProof(proof)).toBe(true)
    expect(isPaymentVerificationState({ required: true, status: 'verified', message: '已核验', proof }, 'old-application')).toBe(true)
  })
  it.each([null, undefined, '0', Number.NaN, Number.POSITIVE_INFINITY, -1])('未知或非法金额 %s 不能代替真实零', (value) => {
    expect(isPaymentVerificationEdit({ ...edit, actualDueAmount: value })).toBe(false)
    expect(isPaymentVerificationEdit({ ...edit, cumulativePayableAmount: value })).toBe(false)
  })
  it('累计可付不能超过累计应付；缺依据、缺实际原件或客户端已核验标记均拒绝', () => {
    for (const value of [{ ...edit, cumulativePayableAmount: 71 }, { ...edit, basis: '' }, { ...edit, fileIds: [] }, { ...edit, fileIds: ['proof-original', 'proof-original'] }, { ...edit, verified: true }])
      expect(isPaymentVerificationEdit(value)).toBe(false)
  })
  it('冻结证据中的源身份、原件归属、版本、unknown及状态不得错配', () => {
    expect(isPaymentVerificationProof({ ...proof, sources: [{ ...proof.sources[0], evidenceJson: JSON.stringify({ id: 'wrong-other', version: '2' }) }] })).toBe(false)
    expect(isPaymentVerificationProof({ ...proof, sources: [{ ...proof.sources[0], version: '3' }] })).toBe(false)
    expect(isPaymentVerificationProof({ ...proof, originals: [{ ...proof.originals[0], ownerId: 'wrong-application' }] })).toBe(false)
    expect(isPaymentVerificationProof({ ...proof, actualDueAmount: null })).toBe(false)
    expect(isPaymentVerificationState({ required: true, status: 'verified', message: '', proof: null }, 'old-application')).toBe(false)
    expect(isPaymentVerificationState({ required: true, status: 'verified', message: '', proof }, 'wrong-application')).toBe(false)
    expect(isPaymentVerificationState({ required: true, status: 'missing', message: '', proof }, 'old-application')).toBe(false)
    expect(isPaymentVerificationState({ required: false, status: 'missing', message: '', proof: null }, 'old-application')).toBe(false)
    expect(isPaymentVerificationProof({ ...proof, verifiedAt: '2026-10-05' })).toBe(false)
    expect(isPaymentVerificationProof({ ...proof, sources: [{ ...proof.sources[0], sourceVersion: 'other-settlement-record-3' }] })).toBe(false)
  })
})
