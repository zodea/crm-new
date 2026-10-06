import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ProjectManagementFeeRow } from '../../app/lib/project/management-fee'
import type { BusinessSession } from './business-session'
import { unavailablePayrollHostSection } from '../../app/lib/crew-worker/payroll-read'
import { managementFeeSource, projectManagementFees } from '../../app/lib/project/management-fee'
import { resolveBusinessSession } from './business-session'
import { loadPayrollHostSection } from './crew-worker-payroll-read'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { resolvePayrollABook } from './payroll-a-book'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { readSourceVersion } from './read-meta'

const allowed = (session: BusinessSession) => session.capabilities.includes('payroll:read') && session.capabilities.includes('project:list:read')
export async function loadProjectManagementFees(tx: TransactionDb, projectId: string, session: BusinessSession, asOf: string) {
  if (!allowed(session))
    return projectManagementFees(projectId, 'real', asOf, managementFeeSource({ key: 'management-payroll', state: 'forbidden', sourceVersion: null, asOf: null, reasons: ['无项目或工资实际来源查看权限'], missingCount: null, rows: [] }, asOf))
  const facts = await loadPayrollActualFacts(tx, { projectId })
  const heads = await tx.select<{ id: string, format_family: string }>('SELECT id,format_family FROM wage_statements WHERE project_id=? AND status=\'released\' ORDER BY id', [projectId])
  const proofs = new Map<string, Awaited<ReturnType<typeof resolvePayrollABook>>>()
  for (const head of heads.filter(head => head.format_family === 'A'))
    proofs.set(head.id, await resolvePayrollABook(tx, head.id))
  const rows: ProjectManagementFeeRow[] = []
  const unexplained = facts.netAmount.reasons.filter(reason => !facts.rows.some(row => row.signedAmount.reasons.includes(reason)))
  const reasons: string[] = [...unexplained]
  let missingCount = 0
  const identities = new Set<string>()
  for (const fact of facts.rows) {
    if (fact.projectId !== projectId || identities.has(fact.identity))
      throw new Error('管理费工资实际来源身份重复')
    identities.add(fact.identity)
    const originals = fact.originalStatementIds.map(id => heads.find(head => head.id === id))
    if (!originals.length || originals.some(head => !head)) {
      missingCount++
      reasons.push('历史工资实际来源缺少完整原工资身份及用途证明')
      continue
    }
    if (originals.every(head => head!.format_family !== 'A'))
      continue
    const books = fact.originalStatementIds.map(id => proofs.get(id))
    if (books.every(book => book?.state === 'proven' && book.book.bookPurpose === 'ordinary'))
      continue
    const book = books[0]
    if (book?.state !== 'proven' || book.book.bookPurpose !== 'management' || books.some(other => other?.state !== 'proven' || other.book.bookPurpose !== 'management' || other.book.managementBookId !== book.book.managementBookId)) {
      missingCount++
      reasons.push('历史工资的普通或管理簿归属尚不能证明，不按姓名或用途文本分类')
      continue
    }
    if (fact.signedAmount.value === null) {
      missingCount++
      reasons.push(...fact.signedAmount.reasons)
    }
    rows.push({ identity: fact.identity, ref: fact.ref, originalStatementIds: [...fact.originalStatementIds], managementBookId: book.book.managementBookId!, amount: fact.signedAmount.value === null ? null : fact.signedAmount.value.toFixed(2), knownValue: fact.signedAmount.knownValue === null ? null : fact.signedAmount.knownValue.toFixed(2), occurredOn: fact.occurredOn, sourceVersion: fact.sourceVersion })
  }
  const source = managementFeeSource({ key: 'management-payroll', state: missingCount || unexplained.length ? 'partial' : 'complete', sourceVersion: readSourceVersion('management-payroll', { facts: facts.sourceVersion, books: [...proofs] }), asOf, reasons: [...new Set(reasons)], missingCount: unexplained.length ? null : missingCount, rows }, asOf)
  return projectManagementFees(projectId, 'real', asOf, source)
}

/** Uses only the existing central payroll owner; no Native or formal fallback. */
export async function loadProjectPayrollEvidence(tx: TransactionDb, projectId: string, session: BusinessSession, asOf: string) {
  const payrollActual = await loadPayrollHostSection(tx, { kind: 'project', id: projectId }, session)
  const managementFees = await loadProjectManagementFees(tx, projectId, session, asOf)
  return { payrollActual, managementFees }
}

export async function readProjectPayrollEvidence(projectId: string, sessionId: string | null | undefined, asOf: string) {
  const session = () => ({ ...resolveBusinessSession(), capabilities: [...demoWorkspaceTestInstance.capabilities(sessionId)] })
  const before = session()
  if (!allowed(before))
    return { payrollActual: unavailablePayrollHostSection({ kind: 'project', id: projectId }, 'forbidden', '无项目或工资实际来源查看权限'), managementFees: projectManagementFees(projectId, 'real', asOf, managementFeeSource({ key: 'management-payroll', state: 'forbidden', sourceVersion: null, asOf: null, reasons: ['无项目或工资实际来源查看权限'], missingCount: null, rows: [] }, asOf)) }
  try {
    const { quantityTestInstance } = await import('./quantity-runtime')
    const result = await quantityTestInstance.withWorkspaceTransaction(tx => loadProjectPayrollEvidence(tx, projectId, before, asOf), sessionId)
    if (JSON.stringify(before) !== JSON.stringify(session()))
      throw new Error('读取期间管理费来源权限已变化')
    return result
  }
  catch {
    const state = allowed(session()) ? 'unavailable' as const : 'forbidden' as const
    return { payrollActual: unavailablePayrollHostSection({ kind: 'project', id: projectId }, state, '工资收付来源暂不可用或授权已变化'), managementFees: projectManagementFees(projectId, 'real', asOf, managementFeeSource({ key: 'management-payroll', state, sourceVersion: null, asOf: null, reasons: ['原工资管理簿实际来源暂不可用或授权已变化'], missingCount: null, rows: [] }, asOf)) }
  }
}
