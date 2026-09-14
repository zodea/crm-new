import type { PayrollAAdjustmentCoverage, PayrollAAdjustmentReconciliation } from './central-a-adjustment-contract'
import { payrollCorrectionAmount } from './central-adjustment-calculation'
import { assertPayrollAdjustmentDraft } from './central-adjustment-validation'
import { payrollCanonical } from './central-command-shared'
import { wireCent, wireExact, wireId, wireNullableNumber, wireObject, wireStrings, wireText } from './central-payroll-wire'
import { amountInCents } from './statements'

const same = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
function metric(value: unknown) {
  return wireObject(value) && wireNullableNumber(value.value) && wireNullableNumber(value.knownValue) && ['known', 'partial', 'unknown'].includes(String(value.state)) && wireStrings(value.reasons) && [value.value, value.knownValue].every(v => v === null || (typeof v === 'number' && wireCent(Math.abs(v)))) && (value.state === 'known' ? value.value !== null && value.value === value.knownValue && !value.reasons.length : value.value === null)
}
export function isPayrollAAdjustmentCoverage(row: unknown): row is PayrollAAdjustmentCoverage {
  try {
    wireExact(row, ['adjustmentId', 'rootAdjustmentId', 'originalStatementId', 'ownershipKey', 'originalSourceFingerprint', 'currentSourceFingerprint', 'originalPriceRevisionId', 'currentPriceRevisionId', 'dimensions', 'reasons'])
    if (![row.adjustmentId, row.rootAdjustmentId, row.originalStatementId, row.originalPriceRevisionId].every(wireId) || !wireText(row.ownershipKey) || !wireText(row.originalSourceFingerprint) || !(row.currentSourceFingerprint === null || wireText(row.currentSourceFingerprint)) || !(row.currentPriceRevisionId === null || wireId(row.currentPriceRevisionId)) || !Array.isArray(row.dimensions) || !wireStrings(row.reasons))
      return false
    for (const d of row.dimensions) {
      wireExact(d, ['dimension', 'before', 'after', 'current', 'effective', 'state'])
      if (!['quantity', 'unit-price', 'pay-ratio'].includes(String(d.dimension)) || ![d.before, d.after, d.current, d.effective].every(wireNullableNumber) || !['included-in-current-source', 'needs-independent-effect', 'unproven'].includes(String(d.state)))
        return false
      if (d.state === 'unproven' ? d.effective !== null : d.after === null || d.effective !== d.after || (d.state === 'included-in-current-source' ? d.current !== d.after : d.current !== d.before))
        return false
    }
    return true
  }
  catch { return false }
}
export function isPayrollAAdjustmentReconciliation(value: unknown): value is PayrollAAdjustmentReconciliation {
  try {
    wireExact(value, ['sourceVersion', 'rawBasis', 'effectiveBasis', 'rawCumulative', 'effectiveCumulative', 'actualNet', 'actualIdentities', 'availableAmount', 'coverage', 'reasons'])
    for (const basis of [value.rawBasis, value.effectiveBasis]) {
      assertPayrollAdjustmentDraft({ reason: '', evidenceNote: '', correctsAdjustmentId: null, basis })
      if (!wireObject(basis) || basis.formatFamily !== 'A')
        return false
    }
    if (!wireText(value.sourceVersion) || !value.sourceVersion || ![value.rawCumulative, value.effectiveCumulative, value.actualNet, value.availableAmount].every(metric) || !wireStrings(value.actualIdentities) || new Set(value.actualIdentities).size !== value.actualIdentities.length || !Array.isArray(value.coverage) || !wireStrings(value.reasons))
      return false
    if (!value.coverage.every(isPayrollAAdjustmentCoverage))
      return false
    const read = value as unknown as PayrollAAdjustmentReconciliation
    if (!same(read.rawBasis.source, read.effectiveBasis.source) || read.rawBasis.periodKind !== read.effectiveBasis.periodKind)
      return false
    const applied = structuredClone(read.rawBasis)
    for (const row of read.coverage) {
      if (row.reasons.length)
        continue
      const component = applied.components.find(c => c.ownershipKey === row.ownershipKey)
      if (!component)
        return false
      for (const d of row.dimensions) {
        if (d.state === 'unproven')
          continue
        if (d.dimension === 'quantity')
          component.quantity = d.effective
        else if (d.dimension === 'unit-price')
          component.unitPrice = d.effective
        else applied.payRatio = d.effective
      }
    }
    if (!same(applied, read.effectiveBasis))
      return false
    if (read.rawCumulative.value !== null && payrollCorrectionAmount(read.rawBasis).value !== read.rawCumulative.value)
      return false
    if (read.effectiveCumulative.value !== null && payrollCorrectionAmount(read.effectiveBasis).value !== read.effectiveCumulative.value)
      return false
    return read.availableAmount.value === null || (read.effectiveCumulative.value !== null && read.actualNet.value !== null && Math.max(0, amountInCents(read.effectiveCumulative.value) - amountInCents(read.actualNet.value)) === amountInCents(read.availableAmount.value))
  }
  catch { return false }
}
