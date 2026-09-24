import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAAdjustmentCoverage, PayrollAAdjustmentDimension, PayrollAAdjustmentReconciliation } from '../../app/lib/payroll/central-a-adjustment-contract'
import type { PayrollAAdjustmentBasis } from '../../app/lib/payroll/central-adjustment-contract'
import { payrollAAmount } from '../../app/lib/payroll/central-a-calculation'
import { isPayrollAStatementSourceVersioned } from '../../app/lib/payroll/central-a-fees-validation'
import { payrollCorrectionAmount } from '../../app/lib/payroll/central-adjustment-calculation'
import { amountInCents } from '../../app/lib/payroll/statements'
import { reconcilePayrollAFeeAdjustments } from './payroll-a-fee-reconciliation'
import { payrollAAdjustmentDimension as dimension, payrollAAdjustmentOwnership as ownership } from './payroll-a-reconciliation-shared'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { payrollAdjustmentChainHeads } from './payroll-adjustment-chain'
import { payrollAdjustmentHash as hash } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentRows, readPayrollAdjustmentRecord } from './payroll-adjustment-records'

/** 原始量价始终保留；每个更正只作用于可证明的责任及变动维度，不以总额相等代替沿革。 */
export async function loadPayrollAAdjustmentReconciliation(tx: TransactionDb, rawBasis: PayrollAAdjustmentBasis, priorStatementIds: string[], statementId: string | null): Promise<PayrollAAdjustmentReconciliation | undefined> {
  if (!isPayrollAStatementSourceVersioned(rawBasis.source))
    return undefined
  const book = rawBasis.source.schemaVersion !== 1 ? rawBasis.source.book : { bookPurpose: 'ordinary', managementBookId: null }
  const records = (await loadPayrollAdjustmentRows(tx)).map(readPayrollAdjustmentRecord).filter(r => r.status === 'confirmed' && r.originalStatementId !== statementId && r.projectId === rawBasis.source.subject.projectId && r.draft.basis?.formatFamily === 'A' && r.draft.basis.source.subject.leaderWorkerId === rawBasis.source.subject.leaderWorkerId && r.draft.basis.source.subject.crewId === rawBasis.source.subject.crewId && hash(r.draft.basis.source.schemaVersion !== 1 ? r.draft.basis.source.book : { bookPurpose: 'ordinary', managementBookId: null }) === hash(book))
  if (!records.length)
    return undefined
  const heads = payrollAdjustmentChainHeads(records)
  const effectiveBasis = structuredClone(rawBasis)
  const coverage: PayrollAAdjustmentCoverage[] = []
  const reasons: string[] = []
  const changed = new Map<string, string>()
  for (const head of heads) {
    const first = records.find(r => r.id === head.rootAdjustmentId)!
    const before = first.snapshot?.preview.before
    const after = head.snapshot?.preview.after
    if (before?.formatFamily !== 'A' || after?.formatFamily !== 'A') {
      reasons.push(`更正 ${head.id} 的原确认组成缺损`)
      continue
    }
    for (const component of after.components) {
      const original = before.components.find(c => c.ownershipKey === component.ownershipKey)
      if (!original || (component.quantity === original.quantity && component.unitPrice === original.unitPrice && before.payRatio === after.payRatio))
        continue
      const oldFact = before.source.facts.find(f => f.ownershipKey === component.ownershipKey)
      const currentFact = rawBasis.source.facts.find(f => f.ownershipKey === component.ownershipKey)
      const current = effectiveBasis.components.find(c => c.ownershipKey === component.ownershipKey)
      const oldPrice = before.source.priceRevisions.find(p => p.id === original.priceRevisionId)
      const currentPrice = rawBasis.source.priceRevisions.find(p => p.id === current?.priceRevisionId)
      const sameOwnership = !!oldFact && !!currentFact && hash(ownership(oldFact)) === hash(ownership(currentFact))
      const samePrice = !!oldPrice && !!currentPrice && oldPrice.priceId === currentPrice.priceId && oldPrice.projectId === currentPrice.projectId && oldPrice.leaderWorkerId === currentPrice.leaderWorkerId && oldPrice.crewId === currentPrice.crewId && oldPrice.itemId === currentPrice.itemId && oldPrice.workerId === currentPrice.workerId && oldPrice.mode === currentPrice.mode && oldPrice.unit === currentPrice.unit && hash(oldPrice.scope) === hash(currentPrice.scope) && currentPrice.revision >= oldPrice.revision
      const dimensions: PayrollAAdjustmentDimension[] = []
      if (component.quantity !== original.quantity)
        dimensions.push(dimension('quantity', original.quantity, component.quantity, current?.quantity ?? null, sameOwnership))
      if (component.unitPrice !== original.unitPrice)
        dimensions.push(dimension('unit-price', original.unitPrice, component.unitPrice, current?.unitPrice ?? null, sameOwnership && samePrice))
      if (before.payRatio !== after.payRatio)
        dimensions.push(dimension('pay-ratio', before.payRatio, after.payRatio, rawBasis.payRatio, sameOwnership))
      const localReasons = dimensions.filter(d => d.state === 'unproven').map(d => `责任 ${component.ownershipKey} 的 ${d.dimension} 已变化，尚不能证明当前来源已包含或可沿用原更正`)
      if (!sameOwnership || !samePrice)
        localReasons.push(`责任 ${component.ownershipKey} 的原施工范围或采用价格沿革不能核实`)
      for (const d of dimensions) {
        const key = d.dimension === 'pay-ratio' ? 'pay-ratio' : `${component.ownershipKey}:${d.dimension}`
        if (changed.has(key) && changed.get(key) !== head.rootAdjustmentId)
          localReasons.push(`责任 ${component.ownershipKey} 的同一维度涉及不同原单更正，需核实前后引用`)
        changed.set(key, head.rootAdjustmentId)
        if (!localReasons.length && current) {
          if (d.dimension === 'quantity')
            current.quantity = d.effective
          else if (d.dimension === 'unit-price')
            current.unitPrice = d.effective
          else effectiveBasis.payRatio = d.effective
        }
      }
      coverage.push({ adjustmentId: head.id, rootAdjustmentId: head.rootAdjustmentId, originalStatementId: head.originalStatementId, ownershipKey: component.ownershipKey, originalSourceFingerprint: oldFact?.sourceFingerprint ?? '', currentSourceFingerprint: currentFact?.sourceFingerprint ?? null, originalPriceRevisionId: original.priceRevisionId, currentPriceRevisionId: current?.priceRevisionId ?? null, dimensions, reasons: localReasons })
      reasons.push(...localReasons)
    }
    const feeCoverage = reconcilePayrollAFeeAdjustments(rawBasis, effectiveBasis, before, after, head, changed)
    coverage.push(...feeCoverage)
    reasons.push(...feeCoverage.flatMap(c => c.reasons))
  }
  const actual = await loadPayrollActualFacts(tx, { projectId: rawBasis.source.subject.projectId, originalStatementIds: priorStatementIds })
  const rawCumulative = payrollCorrectionAmount(rawBasis)
  const effectiveCumulative = payrollCorrectionAmount(effectiveBasis, reasons)
  const actualNet = actual.netAmount
  const availableAmount = effectiveCumulative.value === null || actualNet.value === null ? payrollAAmount([null], [...reasons, ...actualNet.reasons]) : payrollAAmount([Math.max(0, (amountInCents(effectiveCumulative.value) - amountInCents(actualNet.value)) / 100)])
  return { sourceVersion: hash({ rawBasis, effectiveBasis, records, actual, coverage }), rawBasis, effectiveBasis, rawCumulative, effectiveCumulative, actualNet, actualIdentities: actual.rows.map(r => r.identity), availableAmount, coverage, reasons: [...new Set([...reasons, ...actualNet.reasons])] }
}
