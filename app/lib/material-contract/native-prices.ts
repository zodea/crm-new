import type { MigrationDb } from '../db/migrations'
import type { ContractPriceFact } from './price-facts'
import { INEFFECTIVE_EXPENDITURE_CONTRACT_SQL_VALUES } from '../contract/effective-status'

/** One local statement reads heads, lines and current labels without a central identity adapter. */
export async function readNativeContractPrices(db: Pick<MigrationDb, 'select'>): Promise<ContractPriceFact[]> {
  const rows = await db.select<Record<string, unknown>>(`
    SELECT c.id contract_id,l.id line_id,NULL parent_id,c.name contract_name,c.no contract_no,
      c.supplier_id,s.name supplier_name,c.project_id,p.name project_name,c.sign_date,
      l.material_name,l.spec,l.material_grade,l.unit,l.qty,l.tax_inclusive_unit_price,l.applicable_tax_rate
    FROM contract_line_items l JOIN contracts c ON c.id=l.contract_id
      LEFT JOIN suppliers s ON s.id=c.supplier_id AND s.deleted_at IS NULL
      LEFT JOIN projects p ON p.id=c.project_id AND p.deleted_at IS NULL
    WHERE l.deleted_at IS NULL AND c.deleted_at IS NULL AND c.kind='材采'
      AND c.status NOT IN (${INEFFECTIVE_EXPENDITURE_CONTRACT_SQL_VALUES})
    UNION ALL
    SELECT d.id,l.id,c.id,d.name,d.no,c.supplier_id,s.name,c.project_id,p.name,d.sign_date,
      l.material_name,l.spec,l.material_grade,l.unit,l.qty,l.tax_inclusive_unit_price,l.applicable_tax_rate
    FROM contract_supplement_line_items l JOIN contract_supplements d ON d.id=l.supplement_id
      JOIN contracts c ON c.id=d.contract_id
      LEFT JOIN suppliers s ON s.id=c.supplier_id AND s.deleted_at IS NULL
      LEFT JOIN projects p ON p.id=c.project_id AND p.deleted_at IS NULL
    WHERE l.deleted_at IS NULL AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND c.kind='材采'
      AND c.status NOT IN (${INEFFECTIVE_EXPENDITURE_CONTRACT_SQL_VALUES})
      AND d.status NOT IN (${INEFFECTIVE_EXPENDITURE_CONTRACT_SQL_VALUES})
    ORDER BY contract_id,line_id`)
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  const nullableText = (value: unknown) => typeof value === 'string' && value ? value : null
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return rows.map(row => ({ dataOrigin: 'real', contractId: text(row.contract_id), lineId: text(row.line_id), parentContractId: nullableText(row.parent_id), contractName: text(row.contract_name), contractNo: text(row.contract_no), supplierId: nullableText(row.supplier_id), supplierName: nullableText(row.supplier_name), projectId: nullableText(row.project_id), projectName: nullableText(row.project_name), date: nullableText(row.sign_date), materialName: text(row.material_name), spec: text(row.spec), materialGrade: text(row.material_grade), unit: text(row.unit), quantity: number(row.qty), taxInclusiveUnitPrice: number(row.tax_inclusive_unit_price), applicableTaxRate: number(row.applicable_tax_rate) }))
}
