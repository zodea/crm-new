import type { PAYROLL_CENTRAL_MIGRATION_TABLES } from '../migration/payroll-central-source'
import type { PAYROLL_MIGRATION_TABLES } from '../migration/payroll-source'
import type { PAYROLL_A_FEES_MIGRATION_TABLES } from './central-a-fees-schema'
import type { PAYROLL_HOLLOW_DEDUCTION_TABLES } from './central-hollow-deduction-schema'
import type { PAYROLL_NUMBERING_TABLES } from './central-numbering-schema'
import { isStableRouteIdentity } from '../util/stable-route-identity'

export type PayrollSourceIdentityTable = typeof PAYROLL_CENTRAL_MIGRATION_TABLES[number] | typeof PAYROLL_MIGRATION_TABLES[keyof typeof PAYROLL_MIGRATION_TABLES] | typeof PAYROLL_A_FEES_MIGRATION_TABLES[number] | typeof PAYROLL_HOLLOW_DEDUCTION_TABLES[number] | typeof PAYROLL_NUMBERING_TABLES[number]

/** 仅明确工资表的迁入身份；规范 URI 回环也支持再次迁入，不改变通用实体规则。 */
export function isPayrollSourceIdentity(value: unknown, table: PayrollSourceIdentityTable | 'payroll-hollow-policy' | 'payroll-price'): value is string {
  if (isStableRouteIdentity(value) && !value.startsWith('core-payroll_projects-'))
    return true
  if (typeof value !== 'string' || value.length > 4096)
    return false
  const matched = /^core-payroll_projects-[a-f0-9]{24}:([a-z_][a-z0-9_-]*):(.+)$/.exec(value)
  if (!matched || matched[1] !== table)
    return false
  try {
    const original = decodeURIComponent(matched[2]!)
    return original.trim().length > 0 && [...original].every(char => char.charCodeAt(0) >= 32) && encodeURIComponent(original) === matched[2]
  }
  catch { return false }
}
