import type { PayrollNumberingCommand, PayrollNumberingRead } from '../../app/lib/payroll/central-numbering-contract'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from './payroll-c2-service-fixture'

export function numberingCommand(read: PayrollNumberingRead, commandId: string, action: PayrollNumberingCommand['action']): PayrollNumberingCommand {
  return { schemaVersion: 1, commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, ...read.input, action }
}
export async function createPayrollNumberingFixture() {
  const f = await createPayrollC2ServiceFixture()
  try {
    const checked = await createCheckedPayrollC2(f)
    await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 525, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 175 }, { workerId: 'zero', amount: 0 }] } }))
    const input = { projectId: 'p', statementId: checked.statementId! }
    const read = () => f.service.numbering({ origin: 'real' }, input)
    const initialize = async () => f.service.executeNumbering(numberingCommand(await read(), 'numbering-initialize', { kind: 'initialize', nextNumber: 128, evidenceNote: '纸质旧号已核实到127' }))
    const issue = async (id = 'numbering-first-issue') => f.service.executeNumbering(numberingCommand(await read(), id, { kind: 'issue' }))
    return { ...f, input, read, initialize, issue }
  }
  catch (cause) {
    await f.close()
    throw cause
  }
}
