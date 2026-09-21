import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollHollowAdoption, PayrollHollowProcessedAmount } from '../../app/lib/payroll/central-hollow-deduction-contract'
import { payrollAAmount, payrollAMoney } from '../../app/lib/payroll/central-a-calculation'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollAdjustmentChainHeads } from './payroll-adjustment-chain'
import { payrollAdjustmentHash } from './payroll-adjustment-facts'
import { loadPayrollAdjustmentRows, readPayrollAdjustmentRecord } from './payroll-adjustment-records'

/** 有效扣款与实际现金独立：更正确认可改变处理金额，不捏造退款/补款。 */
export async function loadPayrollHollowProcessed(db: TransactionDb, adoptions: PayrollHollowAdoption[]): Promise<PayrollHollowProcessedAmount[]> {
  const result: PayrollHollowProcessedAmount[] = []
  const statements = new Map<string, ReturnType<typeof readPayrollAdjustmentRecord>[]>()
  for (const adoption of adoptions) {
    let records = statements.get(adoption.statementId)
    if (!records) {
      // 权威 loader 已逐次核验并映射迁入正文，不能再从 raw JSON 构造另一套身份。
      records = (await loadPayrollAdjustmentRows(db, adoption.statementId)).map(readPayrollAdjustmentRecord).filter(record => record.status === 'confirmed')
      statements.set(adoption.statementId, records)
    }
    const head = payrollAdjustmentChainHeads(records)[0]
    const basis = head?.snapshot?.preview.after?.hollow
    if (head && (!basis || !basis.source.adoptions.some(original => payrollAdjustmentHash(original) === payrollAdjustmentHash(adoption))))
      throw payrollProblem('unavailable', '原空鼓更正确认没有保留同一已处理采用依据')
    const component = basis?.components.find(component => component.adoptionId === adoption.id && component.recordId === adoption.line.recordId)
    if (basis && (!component || component.count === null || !Number.isSafeInteger(component.count) || component.count < 0 || component.unitAmount === null || component.unitAmount < 0))
      throw payrollProblem('unavailable', '原空鼓更正的完整采用集合或量价不能证明')
    const effectiveAmount = payrollAAmount([component ? payrollAMoney(component.count! * component.unitAmount!) : adoption.line.amount])
    result.push({ adoption, effectiveAmount, adjustmentIds: head ? [head.id] : [], sourceVersion: payrollAdjustmentHash({ adoption, records, effectiveAmount }) })
  }
  return result
}
