import type { SupplierTaxpayerCommand, SupplierTaxpayerResult } from '../../app/lib/supplier/taxpayer-verification'
import type { BusinessSession } from './business-session'
import type { SupplierCredentialPorts } from './supplier-credential-service'
import { createHash, randomUUID } from 'node:crypto'
import { credentialProblem } from '../../app/lib/supplier/credential-contract'
import { verifiedTaxpayerFields } from '../../app/lib/supplier/taxpayer-verification'

export function createSupplierTaxpayerService(ports: Pick<SupplierCredentialPorts, 'transact'>, options: { now?: () => string, createId?: () => string } = {}) {
  return {
    execute(command: SupplierTaxpayerCommand, session: BusinessSession, sessionId?: string | null): SupplierTaxpayerResult {
      if (command.origin !== 'real' || command.workspaceId !== session.workspaceId || command.actorId !== session.actorId
        || command.requiredCapability !== 'supplier:write' || !session.capabilities.includes('supplier:write')) {
        throw credentialProblem('forbidden', '当前会话不能记录此分供方的人工税务核验')
      }
      if (!command.commandId.trim() || !command.expectedTaxNo.trim())
        throw credentialProblem('validation-failed', '请先填写并保存当前分供方税号，再记录核验结果')
      const fingerprint = createHash('sha256').update(`taxpayer:${JSON.stringify(command)}`).digest('hex')
      return ports.transact(command.supplierId, (scope) => {
        const aggregate = scope.aggregate
        const previous = aggregate.commands.find(row => row.commandId === command.commandId)
        if (previous) {
          if (previous.fingerprint !== fingerprint || !('verification' in previous.result))
            throw credentialProblem('conflict', '此核验保存标识已用于其他内容，请核对原提交')
          return { changed: false, value: structuredClone(previous.result) as SupplierTaxpayerResult }
        }
        if (scope.version.toString() !== command.baseSupplierVersion || (scope.draft.taxNo ?? '').trim() !== command.expectedTaxNo.trim())
          throw credentialProblem('conflict', '主档或税号已变化，请保留核验输入并重新核对已保存税号')
        const timestamp = options.now?.() ?? new Date().toISOString()
        const verification = verifiedTaxpayerFields(command.draft, timestamp)
        Object.assign(scope.draft, verification)
        const auditId = options.createId?.() ?? randomUUID()
        aggregate.supplierAudits.push({ id: auditId, action: 'taxpayer_verification', outcome: command.draft.status, sourceCategory: command.draft.status === 'manually_confirmed' ? 'manual_document' : 'official_website', changedFields: Object.keys(verification), notePresent: Boolean(verification.taxpayerVerificationNote), createdAt: timestamp, actorId: session.actorId })
        aggregate.version++
        if (aggregate.migrationBatchId)
          aggregate.changedAfterMigration = true
        const result: SupplierTaxpayerResult = { commandId: command.commandId, supplierId: command.supplierId, supplierVersion: String(scope.version + 1), credentialVersion: String(aggregate.version), credentialId: null, auditId, deletionToken: null, verification }
        aggregate.commands.push({ commandId: command.commandId, fingerprint, result })
        return { changed: true, value: structuredClone(result) }
      }, sessionId)
    },
  }
}
