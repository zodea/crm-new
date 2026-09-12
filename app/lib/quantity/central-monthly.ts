import type { SoftDb } from '../db/soft-delete'
import type { QuantityBasis } from './basis'
import type { QuantityBoqLine } from './central-boq'
import type { QuantityReadQuery } from './central-contract'
import { hiddenCtesFor, visibleCond } from '../db/soft-delete'
import { assertQuantityBasis, QUANTITY_BASIS_COLUMNS } from './basis'
import { quantityProblem } from './central-contract'

export interface QuantityMonthlyReadQuery extends QuantityReadQuery { basis?: QuantityBasis }

export interface QuantityMonthlyBoqFact {
  projectId: string
  contractId: string
  periodNo: string
  boqLineId: string
  /** 所选基准的已知小计；missingQtyCount > 0 时不能自动当成完整申报量。 */
  autoQty: number
  missingQtyCount: number
  quantityBasis: QuantityBasis
  sourceVersion: string
  sourceUpdatedAt: string | null
}

export async function loadQuantityMonthlyBoqFacts(db: Pick<SoftDb, 'select'>, projectId: string, lines: readonly QuantityBoqLine[], sourceVersion: string, basis: QuantityBasis = 'field'): Promise<QuantityMonthlyBoqFact[]> {
  assertQuantityBasis(basis)
  const column = QUANTITY_BASIS_COLUMNS[basis]
  const byId = new Map(lines.map(line => [line.id, line]))
  const unconfigured = await db.select<{ boq_line_id: string, item_name: string }>(
    `${hiddenCtesFor('units', 'house_type_template_items', 'construction_stage_items')}
     SELECT DISTINCT hti.boq_line_id, item.name AS item_name
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     JOIN rooms r ON r.template_id = ht.id
     JOIN house_type_template_items hti ON hti.room_id = r.id
     JOIN items item ON item.id = hti.item_id
     WHERE ${visibleCond('units', 'u')} AND ${visibleCond('house_type_template_items', 'hti')}
       AND b.project_id = ? AND ht.project_id = ? AND item.project_id = ?
       AND hti.boq_line_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM construction_stage_items csi
         JOIN construction_stages s ON s.id = csi.stage_id
         WHERE csi.item_id = item.id AND csi.is_reporting_stage = 1
           AND s.project_id = ? AND s.trade = item.trade
           AND ${visibleCond('construction_stage_items', 'csi')}
       )`,
    [projectId, projectId, projectId, projectId],
  )
  const missing = unconfigured.find(row => byId.has(row.boq_line_id))
  if (missing)
    throw quantityProblem('validation-failed', `分项「${missing.item_name}」尚未指定有效报量阶段，请先在工程量阶段配置中明确选择后再取数`)
  const rows = await db.select<{ boq_line_id: string, month: string, qty: number | null, missing: number, updated_at: string }>(
    `${hiddenCtesFor('unit_stage_completions', 'construction_stage_items', 'house_type_template_items')}
     SELECT hti.boq_line_id, substr(usc.completed_at, 1, 7) AS month,
       SUM(hti.${column}) AS qty,
       SUM(CASE WHEN hti.${column} IS NULL THEN 1 ELSE 0 END) AS missing,
       MAX(MAX(usc.updated_at, hti.updated_at, csi.updated_at)) AS updated_at
     FROM unit_stage_completions usc
     JOIN units u ON u.id = usc.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     JOIN construction_stages s ON s.id = usc.stage_id
     JOIN construction_stage_items csi ON csi.stage_id = usc.stage_id
     JOIN items item ON item.id = csi.item_id
     JOIN house_type_template_items hti ON hti.item_id = csi.item_id
     JOIN rooms r ON r.id = hti.room_id AND r.template_id = u.house_type_template_id
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND ${visibleCond('construction_stage_items', 'csi')}
       AND ${visibleCond('house_type_template_items', 'hti')}
       AND csi.is_reporting_stage = 1 AND usc.status = 'completed'
       AND usc.completed_at IS NOT NULL AND hti.boq_line_id IS NOT NULL
       AND b.project_id = ? AND ht.project_id = ? AND s.project_id = ? AND item.project_id = ?
     GROUP BY hti.boq_line_id, month ORDER BY month, hti.boq_line_id`,
    [projectId, projectId, projectId, projectId],
  )
  return rows.flatMap((row) => {
    const line = byId.get(row.boq_line_id)
    if (!line)
      return []
    return [{
      projectId,
      contractId: line.contractId,
      periodNo: row.month,
      boqLineId: line.id,
      autoQty: Math.round(((row.qty ?? 0) + Number.EPSILON) * 1_000_000) / 1_000_000,
      missingQtyCount: row.missing,
      quantityBasis: basis,
      sourceVersion,
      sourceUpdatedAt: row.updated_at || null,
    }]
  })
}
