import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createSubcontractContractCommandTestInstance } from '../../server/utils/subcontract-contract-command-test-instance'
import { createSubcontractContractReadTestInstance } from '../../server/utils/subcontract-contract-read-test-instance'

const session = { workspaceId: 'workspace-321', actorId: 'actor-321', capabilities: [CORE_MIGRATION_CAPABILITY, 'subcontract-contract:read', 'subcontract-contract:write'] }

function source(): CoreMigrationSourceDTO {
  const unsigned = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
    entities: {
      customers: [],
      suppliers: [{ legacyId: 'supplier-old', name: '既有分供方', deletedAt: null }],
      crews: [],
      projects: [{ legacyId: 'project-old', name: '既有项目', references: { customerId: null, secondaryCustomerId: null }, deletedAt: null }],
      construction_contracts: [],
      subcontract_contracts: [{
        legacyId: 'subcontract-old',
        name: '既有劳务分包',
        amount: '880000.00' as const,
        deletedAt: null,
        references: { projectId: 'project-old', supplierId: 'supplier-old' },
        attributes: { no: 'FB-LEGACY-321', subKind: '劳务', content: '受控迁移分包合同', signDate: '2026-01-08', status: '履约中', settlementStatus: null, clearanceStatus: null, createdAt: '2026-01-08T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' },
      }],
      contract_supplements: [{
        legacyId: 'subcontract-supplement-old',
        name: '既有劳务范围补充协议',
        amount: '18000.00' as const,
        deletedAt: null,
        references: { contractId: 'subcontract-old' },
        attributes: { no: 'FB-LEGACY-321-BC01', signDate: '2026-02-08', status: '生效' },
      }],
      receipt_registrations: [],
      owner_documents: [],
      workers: [],
      project_suppliers: [],
    },
  }
  return { ...unsigned, sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(unsigned)).digest('hex') }
}

describe('分包合同受控中央迁移', () => {
  it('确认后以服务端稳定 ID 进入同一命令源，回滚后撤销', async () => {
    const commands = createSubcontractContractCommandTestInstance({ now: () => '2026-08-25T01:00:00.000Z' })
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-25T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
      afterRollback: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const migrationSource = source()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await core.preflight({ ...envelope('preflight-321'), source: migrationSource, backup: null }, session)
    const snapshotSha256 = 'b'.repeat(64)
    const batch = await core.dryRun({ ...envelope('dry-run-321'), source: migrationSource, backup: { backupId: `core-migration-${migrationSource.sourceHash}-${snapshotSha256}`, sourceHash: migrationSource.sourceHash, sourceVersion: migrationSource.sourceVersion, snapshotSha256, byteLength: 128, createdAt: '2026-08-25T00:00:00.000Z', immutable: true } }, session)
    await core.importBatch({ ...envelope('import-321'), batchId: batch.batchId }, session)
    await core.confirm({ ...envelope('confirm-321'), batchId: batch.batchId }, session)

    const id = 'central-subcontract_contracts-subcontract-old'
    const supplementId = 'central-contract_supplements-subcontract-supplement-old'
    expect(commands.form(id, session).draft).toMatchObject({ id, name: '既有劳务分包', projectId: 'central-projects-project-old', supplierId: 'central-suppliers-supplier-old', subKind: '劳务' })
    const read = createSubcontractContractReadTestInstance(() => ['subcontract-contract:read'], commands)
    expect(read.detail(id, { origin: 'real', focusId: supplementId }).sections.supplements)
      .toContainEqual(expect.objectContaining({
        id: supplementId,
        no: 'FB-LEGACY-321-BC01',
        navigation: expect.objectContaining({
          subject: expect.objectContaining({ entity: 'contract', id }),
          view: supplementId,
        }),
      }))
    await core.rollback({ ...envelope('rollback-321'), batchId: batch.batchId }, session)
    expect(() => commands.form(id, session)).toThrow('未找到分包合同')
  })

  it('将同一中央命令源中的分包变洽签并入合同事实并生成专属导航', async () => {
    const commands = createSubcontractContractCommandTestInstance({
      createId: () => 'subcontract-central-327',
      projects: [{ id: 'project-central-327', name: '中央项目' }],
      suppliers: [{ id: 'supplier-central-327', name: '中央分供方' }],
    })
    const ownerDocuments = {
      rows: () => [{
        dataOrigin: 'real' as const,
        kind: 'sub_change' as const,
        id: 'sub-change-central-327',
        contractId: 'subcontract-central-327',
        no: 'FB-BQ-327',
        name: '样板层分包范围调整',
        amount: 32000,
        applicationDate: '2026-08-26' as const,
        status: 'submitted',
      }],
      sourceVersion: () => 'owner-document-command-7',
    }
    const read = createSubcontractContractReadTestInstance(
      () => ['subcontract-contract:read', 'subcontract-document:read'],
      commands,
      ownerDocuments,
    )

    await commands.execute({
      workspaceId: 'workspace-327',
      actorId: 'actor-327',
      requiredCapability: 'subcontract-contract:write',
      commandId: 'create-subcontract-327',
      baseVersion: null,
      action: 'submit',
      draft: {
        no: 'FB-327',
        name: '中央分包合同',
        projectId: 'project-central-327',
        supplierId: 'supplier-central-327',
        subKind: '劳务',
        content: '劳务分包',
        signDate: '2026-08-01',
        amount: 800000,
        status: '履约中',
      },
      attachments: {},
    }, {
      workspaceId: 'workspace-327',
      actorId: 'actor-327',
      capabilities: ['subcontract-contract:read', 'subcontract-contract:write'],
    })

    const detail = read.detail('subcontract-central-327', { origin: 'real' })
    expect(detail.sourceVersion).toContain('owner-document-command-7')
    expect(detail.sections.changes).toContainEqual(expect.objectContaining({
      id: 'sub-change-central-327',
      no: 'FB-BQ-327',
      amount: '32000.00',
      status: '已提交',
      navigation: expect.objectContaining({
        subject: expect.objectContaining({ entity: 'subcontract-document', id: 'sub-change-central-327' }),
        variant: 'change',
      }),
    }))
  })
})
