import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollActualRef, PayrollProofRef } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollWorkbookArchive } from '../../app/lib/payroll/central-workbook-contract'
import type { WorkerRosterArchive } from '../../app/lib/worker-roster/contract'
import { hasPayrollAFeesDocument } from '../../app/lib/payroll/central-a-fees-contract'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { hasProductionPayrollSchema } from '../../app/lib/payroll/central-schema'
import { createPayrollAdjustmentReferenceCollector } from './payroll-adjustment-migration-references'
import { createPayrollFeesReferenceCollector } from './payroll-fees-migration-references'
import { createPayrollHollowReferenceCollector } from './payroll-hollow-migration-references'

export interface PayrollWorkbookReference { tableName: string, recordId: string }
/** Closed DTO relationships only: names, notes, amounts and digest strings are never identities. */
export function collectWorkbookReferences(archive: Pick<PayrollWorkbookArchive, 'input' | 'groups' | 'issues' | 'rosterRef'>, rosterArchive?: WorkerRosterArchive): PayrollWorkbookReference[] {
  const refs = new Map<string, PayrollWorkbookReference>()
  const add = (tableName: string, recordId: string | null | undefined) => {
    if (recordId)
      refs.set(JSON.stringify([tableName, recordId]), { tableName, recordId })
  }
  const merge = (references: Set<string>) => {
    for (const reference of references) {
      const [table, id] = JSON.parse(reference) as [string, string]
      add(table, id)
    }
  }
  const actual = (ref: PayrollActualRef | null) => {
    if (ref)
      add(ref.kind === 'actual-event' ? 'payroll_actual_events' : 'wage_statements', ref.kind === 'actual-event' ? ref.eventId : ref.statementId)
  }
  const proof = (ref: PayrollProofRef) => add({ 'frozen-source': 'wage_statements', 'adjustment-confirmation': 'payroll_adjustments', 'actual-confirmation': 'payroll_actual_events' }[ref.kind], ref.id)
  add('projects', archive.input.projectId)
  archive.input.statementIds.forEach(id => add('wage_statements', id))
  add('worker_roster_archives', archive.rosterRef?.id)
  for (const issue of archive.issues) {
    add('payroll_official_issues', issue.id)
    add('payroll_command_receipts', issue.commandId)
  }
  for (const group of archive.groups) {
    for (const { row, document } of group.entries) {
      add('wage_statements', row.id)
      add('crews', row.crewId)
      add('workers', row.leaderWorkerId)
      add('payroll_subject_configs', row.subjectConfigId)
      add('payroll_a_management_books', row.book?.managementBookId)
      document.members.forEach(member => add('workers', member.workerId))
      document.allocations.forEach(member => add('workers', member.workerId))
      if (document.formatFamily === 'A') {
        if (hasPayrollAFeesDocument(document)) {
          const fees = createPayrollFeesReferenceCollector()
          fees.identity(document.book)
          fees.feesSnapshot(document.fees)
          for (const payment of document.previousBookPayments) {
            fees.identity(payment.book)
            add('wage_statements', payment.statementId)
          }
          merge(fees.refs)
        }
        if (document.adjustmentReconciliation) {
          const adjustment = createPayrollAdjustmentReferenceCollector()
          adjustment.reconciliation(document.adjustmentReconciliation)
          merge(adjustment.refs)
        }
        document.previousPayments.forEach(payment => add('wage_statements', payment.statementId))
        for (const line of document.lines) {
          add('workers', line.workerId)
          add('items', line.itemId)
          line.priceRevisionIds.forEach(id => add('payroll_a_price_revisions', id))
          for (const fact of line.facts) {
            if (fact.productionUpstream) {
              add('construction_contract_records', fact.productionUpstream.mainContractId)
              add('boq_lines', fact.productionUpstream.boqLineId)
            }
            for (const [field, table] of Object.entries({ workerId: 'workers', crewId: 'crews', completionId: 'unit_stage_completions', assignmentId: 'unit_assignments', stageId: 'construction_stages', stageItemId: 'construction_stage_items', unitId: 'units', floorId: 'floors', buildingId: 'buildings', templateId: 'house_type_templates', templateLineId: 'house_type_template_items', roomId: 'rooms', itemId: 'items' }) as Array<[keyof typeof fact, string]>)
              add(table, fact[field] as string | null)
            fact.assignmentScopeIds.forEach(id => add('unit_assignment_scopes', id))
            for (const scope of fact.scopeRows) {
              add('unit_assignment_scopes', scope.id)
              add('rooms', scope.roomId)
              add('items', scope.itemId)
            }
          }
        }
      }
      else if (document.formatFamily === 'C1') {
        document.attendance.forEach(fact => add('attendance_records', fact.id))
        document.rates.forEach(rate => add('payroll_c1_rate_revisions', rate.configId))
      }
      else {
        document.daywork.forEach(fact => add('signed_daywork_records', fact.id))
        add('payroll_subject_configs', document.config.id)
      }
      if (document.hollow) {
        const hollow = createPayrollHollowReferenceCollector()
        hollow.snapshot(document.hollow)
        merge(hollow.refs)
      }
    }
    for (const fact of group.actualLedger.rows) {
      actual(fact.ref)
      actual(fact.reverses)
      fact.originalStatementIds.forEach(id => add('wage_statements', id))
      fact.adjustmentIds.forEach(id => add('payroll_adjustments', id))
      fact.applicationIds.forEach(id => add('payroll_adjustment_applications', id))
      for (const member of [...fact.allocations, ...fact.historicalMembers]) {
        add('workers', member.workerId)
        add('crews', member.crewId)
      }
      fact.allocations.forEach(row => row.proofRefs.forEach(proof))
    }
  }
  if (rosterArchive) {
    add('worker_roster_archives', rosterArchive.id)
    for (const member of rosterArchive.members) {
      add('workers', member.workerId)
      add('crews', member.profile?.crewId)
      add('projects', member.profile?.currentProjectId)
      member.statementIds.forEach(id => add('wage_statements', id))
      member.photos.forEach(photo => add('worker_roster_assets', photo.id))
    }
  }
  return [...refs.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

/** Asset and file identities can differ after migration; resolve the owning row in the same transaction. */
export async function completeWorkbookReferences(db: TransactionDb, archive: PayrollWorkbookArchive, rosterArchive?: WorkerRosterArchive): Promise<PayrollWorkbookReference[]> {
  const refs = collectWorkbookReferences(archive, rosterArchive)
  if (!archive.migration && await hasProductionPayrollSchema(db)) {
    // New formal directories also freeze the physical evidence behind their closed DTOs.
    // Imported directories retain their original reference/proof contract without rewriting it.
    for (const statementId of archive.input.statementIds) {
      for (const tableName of ['wage_statement_lines', 'wage_statement_members', 'wage_statement_allocations', 'wage_statement_daywork_records']) {
        const rows = await db.select<{ id: string }>(`SELECT id FROM ${tableName} WHERE statement_id=?`, [statementId])
        rows.forEach(row => refs.push({ tableName, recordId: row.id }))
      }
      for (const tableName of ['payroll_a_statement_sources', 'payroll_c1_statement_sources', 'payroll_c2_statement_sources']) {
        if ((await db.select(`SELECT statement_id FROM ${tableName} WHERE statement_id=?`, [statementId])).length)
          refs.push({ tableName, recordId: statementId })
      }
      for (const row of await db.select<{ command_id: string }>('SELECT command_id FROM payroll_command_receipts WHERE statement_id=?', [statementId]))
        refs.push({ tableName: 'payroll_command_receipts', recordId: row.command_id })
      for (const row of await db.select<{ id: string, plan_id: string }>('SELECT id,plan_id FROM payroll_batch_attempts WHERE json_extract(command_json,\'$.statementId\')=?', [statementId])) {
        refs.push({ tableName: 'payroll_batch_attempts', recordId: row.id }, { tableName: 'payroll_batch_plans', recordId: row.plan_id })
        for (const receipt of await db.select<{ command_id: string }>('SELECT command_id FROM payroll_batch_command_receipts WHERE plan_id=?', [row.plan_id]))
          refs.push({ tableName: 'payroll_batch_command_receipts', recordId: receipt.command_id })
      }
    }
    for (const event of refs.filter(ref => ref.tableName === 'payroll_actual_events')) {
      for (const row of await db.select<{ id: string }>('SELECT id FROM payroll_actual_allocations WHERE event_id=?', [event.recordId]))
        refs.push({ tableName: 'payroll_actual_allocations', recordId: row.id })
    }
  }
  for (const member of rosterArchive?.members ?? []) {
    for (const photo of member.photos) {
      const [row] = await db.select<{ file_ref_id: string, sha256: string }>('SELECT asset.file_ref_id,asset.sha256 FROM worker_roster_assets asset JOIN file_refs file ON file.id=asset.file_ref_id AND file.owner_type=\'worker\' AND file.owner_id=asset.worker_id WHERE asset.id=? AND asset.worker_id=?', [photo.id, member.workerId])
      if (!row || row.sha256 !== photo.sha256)
        throw payrollProblem('unavailable', '固定名册照片的原件归属或摘要不可证明')
      refs.push({ tableName: 'file_refs', recordId: row.file_ref_id })
    }
  }
  return [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}
