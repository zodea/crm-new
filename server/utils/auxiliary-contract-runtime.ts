import type { AuxiliaryContractDraft } from '../../app/lib/auxiliary-contract/contract'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { createAuxiliaryContractTestInstance } from './auxiliary-contract-test-instance'
import { resolveBusinessSession } from './business-session'
import { otherSettlementInstance } from './other-settlement-runtime'
import { projectCommandTestInstance } from './project-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

const instances = new Map<string, ReturnType<typeof createAuxiliaryContractTestInstance>>()
const scenarios = new Map<string, string>()
export function auxiliaryContractInstance(sessionId?: string | null) {
  const key = sessionId || 'default'
  if (!instances.has(key)) {
    instances.set(key, createAuxiliaryContractTestInstance({
      settlements: contractId => otherSettlementInstance(sessionId).contractFacts(contractId),
      identities: () => ({ projects: projectCommandTestInstance.rows(sessionId).filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name })), suppliers: supplierCommandTestInstance.rows(sessionId).filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name })) }),
    }))
  }
  return instances.get(key)!
}
export function auxiliaryContractSession(sessionId?: string | null) {
  const scenario = scenarios.get(sessionId || 'default')
  if (scenario === 'unavailable')
    throw auxiliaryProblem('unavailable', '合同服务暂时不可用，请重试')
  const session = resolveBusinessSession()
  return scenario === 'forbidden' ? { ...session, capabilities: [] } : session
}
export async function resetAuxiliaryContractInstance(sessionId: string, scenario: string) {
  scenarios.set(sessionId, scenario)
  instances.delete(sessionId)
  if (scenario === 'ready') {
    const instance = createAuxiliaryContractTestInstance({
      settlements: contractId => otherSettlementInstance(sessionId).contractFacts(contractId),
      projects: [{ id: 'project-real-320', name: '中央正式施工项目' }],
      suppliers: [{ id: 'supplier-real-327', name: '中央正式劳务分供方' }],
    })
    instances.set(sessionId, instance)
    const session = resolveBusinessSession()
    const drafts: AuxiliaryContractDraft[] = [
      { kind: 'other_expense', name: '验收检测服务合同', no: 'QT-330-001', category: '检测服务', projectId: 'project-real-320', supplierId: 'supplier-real-327', signDate: '2026-09-06', amount: 10600, taxRate: 6 },
      { kind: 'company_expense', name: '办公室租赁合同', no: 'GS-330-001', category: '房租', counterparty: '测试出租单位', partyA: '测试承租公司', signDate: '2026-09-06', amount: 1060, taxRate: 6 },
    ]
    for (const draft of drafts)
      await instance.execute({ ...session, requiredCapability: 'auxiliary-contract:write', commandId: `fixture-${draft.kind}`, baseVersion: null, action: 'save', draft, attachments: {} }, session)
  }
}
