import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  coreMigrationSourceHashInput,
} from '~/lib/migration/core-contract'
import { createConstructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { createConstructionContractReadTestInstance } from '../../server/utils/construction-contract-read-test-instance'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'

const session = {
  workspaceId: 'workspace-migration-320',
  actorId: 'actor-migration-320',
  capabilities: [CORE_MIGRATION_CAPABILITY, 'construction-contract:read', 'construction-contract:write'],
}

function source(): CoreMigrationSourceDTO {
  const withoutHash = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
    entities: {
      customers: [{ legacyId: 'customer-legacy', name: '既有甲方', deletedAt: null }],
      suppliers: [],
      crews: [],
      projects: [{ legacyId: 'project-legacy', name: '既有项目', references: { customerId: 'customer-legacy', secondaryCustomerId: null }, deletedAt: null }],
      construction_contracts: [{
        legacyId: 'contract-legacy',
        name: '既有施工合同',
        references: { projectId: 'project-legacy', customerId: 'customer-legacy' },
        amount: '960000.00' as const,
        deletedAt: null,
        attributes: {
          no: 'SG-LEGACY-320',
          content: '受控迁移施工合同',
          signDate: '2026-01-08',
          status: '履约中',
          actualCompletionDate: null,
          createdAt: '2026-01-08T00:00:00.000Z',
          updatedAt: '2026-08-24T00:00:00.000Z',
        },
      }],
      subcontract_contracts: [],
      contract_supplements: [{
        legacyId: 'supplement-legacy',
        name: '既有材料调价补充协议',
        references: { contractId: 'contract-legacy' },
        amount: '8000.00' as const,
        deletedAt: null,
        attributes: {
          no: 'SG-LEGACY-320-BC01',
          signDate: '2026-02-08',
          status: '有效',
        },
      }],
      receipt_registrations: [],
      owner_documents: [],
      workers: [],
      project_suppliers: [],
    },
  }
  return {
    ...withoutHash,
    sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(withoutHash)).digest('hex'),
  }
}

describe('施工合同受控中央迁移', () => {
  it('确认核心迁移后按稳定 ID 进入同一中央命令源并完成编辑刷新', async () => {
    const commands = createConstructionContractCommandTestInstance({
      now: () => '2026-08-24T01:00:00.000Z',
    })
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-24T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
      afterRollback: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
      afterReset: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const migrationSource = source()
    const envelope = (commandId: string) => ({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CORE_MIGRATION_CAPABILITY,
      commandId,
    })
    await core.preflight({ ...envelope('preflight-320'), source: migrationSource, backup: null }, session)
    const snapshotSha256 = 'b'.repeat(64)
    const dryRun = await core.dryRun({
      ...envelope('dry-run-320'),
      source: migrationSource,
      backup: {
        backupId: `core-migration-${migrationSource.sourceHash}-${snapshotSha256}`,
        sourceHash: migrationSource.sourceHash,
        sourceVersion: migrationSource.sourceVersion,
        snapshotSha256,
        byteLength: 42,
        createdAt: '2026-08-24T00:00:00.000Z',
        immutable: true,
      },
    }, session)
    await core.importBatch({ ...envelope('import-320'), batchId: dryRun.batchId }, session)
    await core.confirm({ ...envelope('confirm-320'), batchId: dryRun.batchId }, session)

    const read = createConstructionContractReadTestInstance(
      () => ['construction-contract:read'],
      commands,
    )
    const id = 'central-construction_contracts-contract-legacy'
    const supplementId = 'central-contract_supplements-supplement-legacy'
    const detail = read.detail(id, { origin: 'real', focusId: supplementId })

    expect(detail.contract).toMatchObject({
      id,
      no: 'SG-LEGACY-320',
      name: '既有施工合同',
      actualCompletionDate: null,
      project: { state: 'resolved', label: '既有项目' },
      customer: { state: 'resolved', label: '既有甲方' },
    })
    expect(detail.sections.supplements).toContainEqual(expect.objectContaining({
      id: supplementId,
      no: 'SG-LEGACY-320-BC01',
      name: '既有材料调价补充协议',
      navigation: expect.objectContaining({
        subject: expect.objectContaining({ entity: 'contract', id }),
        view: supplementId,
      }),
    }))

    const form = commands.form(id, session)
    expect(form.draft).toMatchObject({
      id,
      name: '既有施工合同',
      projectId: 'central-projects-project-legacy',
      customerId: 'central-customers-customer-legacy',
    })
    await commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'construction-contract:write',
      commandId: 'update-migrated-contract-320',
      id,
      baseVersion: form.version,
      action: 'save',
      draft: { ...form.draft, name: '既有施工合同（已编辑）' },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)

    expect(read.detail(id, { origin: 'real' }).contract).toMatchObject({
      id,
      name: '既有施工合同（已编辑）',
      actualCompletionDate: null,
    })

    await core.reset(session.workspaceId)
    expect(() => commands.form(id, session)).toThrow('正式施工合同不存在')
    expect(() => read.detail(id, { origin: 'real' })).toThrow('施工合同不存在')
  })
})
