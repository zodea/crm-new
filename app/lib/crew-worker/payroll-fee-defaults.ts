import type { PayrollCrewFeeDefaults, PayrollFieldFact } from '../payroll/central-a-fees-contract'

export const CREW_PAYROLL_FEE_FIELDS = [
  { attribute: 'rentSubsidyEnabled', column: 'rent_subsidy_enabled', fact: 'rentEnabled', kind: 'boolean' },
  { attribute: 'rentSubsidyPrice', column: 'rent_subsidy_price', fact: 'rentUnitPrice', kind: 'number' },
  { attribute: 'mgmtFeeEnabled', column: 'mgmt_fee_enabled', fact: 'managementEnabled', kind: 'boolean' },
  { attribute: 'mgmtFeePrice', column: 'mgmt_fee_price', fact: 'managementUnitPrice', kind: 'number' },
] as const
export type CrewPayrollFeeValues = Omit<PayrollCrewFeeDefaults, 'crewId' | 'sourceVersion'>

/** 原 SQL 开关保持 0/1；未存在的列/属性不补 null。 */
export function crewPayrollFeeAttributes(value: Record<string, unknown>): Record<string, number | null> {
  const result: Record<string, number | null> = {}
  for (const field of CREW_PAYROLL_FEE_FIELDS) {
    if (!Object.hasOwn(value, field.attribute))
      continue
    const entry = value[field.attribute]
    if (entry !== null && (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || (field.kind === 'boolean' && entry !== 0 && entry !== 1)))
      throw new Error(`班组费用默认 ${field.attribute} 不是可确认的${field.kind === 'boolean' ? '0/1 开关' : '非负数值'}或空值`)
    result[field.attribute] = entry as number | null
  }
  return result
}

export function crewPayrollFeeValues(attributes: Record<string, unknown>): CrewPayrollFeeValues {
  const values = crewPayrollFeeAttributes(attributes)
  return Object.fromEntries(CREW_PAYROLL_FEE_FIELDS.map(field => [field.fact, !Object.hasOwn(values, field.attribute)
    ? { state: 'missing' }
    : values[field.attribute] === null
      ? { state: 'null', value: null }
      : { state: 'value', value: field.kind === 'boolean' ? values[field.attribute] === 1 : values[field.attribute] }])) as CrewPayrollFeeValues
}

/** 既有表单显示的 false/null 不具备采用资格，未变更字段沿用原 presence。 */
export function updatedCrewPayrollFeeValues(draft: object, previous?: { draft: object, values: CrewPayrollFeeValues }): CrewPayrollFeeValues {
  return Object.fromEntries(CREW_PAYROLL_FEE_FIELDS.map((field) => {
    const entry = (draft as Record<string, unknown>)[field.attribute]
    let fact: PayrollFieldFact<boolean | number>
    if (previous && (!Object.hasOwn(draft, field.attribute) || entry === (previous.draft as Record<string, unknown>)[field.attribute])) {
      fact = previous.values[field.fact]
    }
    else if (entry === undefined) {
      fact = { state: 'missing' }
    }
    else if (entry === null) {
      fact = { state: 'null', value: null }
    }
    else {
      if (field.kind === 'boolean' ? typeof entry !== 'boolean' : typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0)
        throw new Error(`班组费用默认 ${field.attribute} 无效`)
      fact = { state: 'value', value: entry as boolean | number }
    }
    return [field.fact, fact]
  })) as CrewPayrollFeeValues
}
