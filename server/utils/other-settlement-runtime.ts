import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { auxiliaryContractInstance } from './auxiliary-contract-runtime'
import { resolveBusinessSession } from './business-session'
import { createOtherSettlementInstance } from './other-settlement-instance'
import { otherSettlementTestRecords } from './other-settlement-test-fixtures'

const instances = new Map<string, ReturnType<typeof createOtherSettlementInstance>>()
const scenarios = new Map<string, string>()
export function otherSettlementInstance(key?: string | null) {
  const id = key || 'default'
  if (!instances.has(id))
    instances.set(id, createOtherSettlementInstance({ identities: () => auxiliaryContractInstance(key).otherSettlementContext(resolveBusinessSession()) }))
  return instances.get(id)!
}
export function otherSettlementSession(key?: string | null) {
  const scenario = scenarios.get(key || 'default')
  if (scenario === 'unavailable')
    throw auxiliaryProblem('unavailable', '其他支出结算读取失败，请重试')
  const session = resolveBusinessSession()
  return scenario === 'forbidden' ? { ...session, capabilities: [] } : session
}
export async function resetOtherSettlementInstance(key: string, scenario: string) {
  scenarios.set(key, scenario)
  if (scenario === 'ready' || scenario === 'empty')
    instances.delete(key)
  if (scenario === 'related') {
    const identities = () => auxiliaryContractInstance(key).otherSettlementContext(resolveBusinessSession())
    instances.set(key, createOtherSettlementInstance({ identities, records: otherSettlementTestRecords({ ...resolveBusinessSession(), ...identities() }) }))
  }
}
