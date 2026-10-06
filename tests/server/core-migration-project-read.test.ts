import type {
  CoreMigrationBackupAttestationDTO,
  CoreMigrationBatchCommandDTO,
  CoreMigrationSourceCommandDTO,
  CoreMigrationSourceDTO,
} from '../../app/lib/migration/core-contract'
import type { BusinessSession } from '../../server/utils/business-session'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  coreMigrationSourceHashInput,
} from '../../app/lib/migration/core-contract'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createCustomerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { createProjectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { createProjectReadTestInstance } from '../../server/utils/project-read-test-instance'

const SESSION: BusinessSession = {
  workspaceId: 'workspace-default',
  actorId: 'actor-default',
  capabilities: [CORE_MIGRATION_CAPABILITY, 'project:list:read'],
}

function migrationSource(): CoreMigrationSourceDTO {
  const unsigned = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
    entities: {
      customers: [{ legacyId: 'customer-local-1', name: '迁移客户' }],
      suppliers: [],
      crews: [],
      projects: [{
        legacyId: 'project-local-1',
        name: '迁移项目',
        amount: '8800.00',
        references: { customerId: 'customer-local-1' },
      }],
      construction_contracts: [],
      subcontract_contracts: [],
      contract_supplements: [],
      receipt_registrations: [],
      owner_documents: [],
      workers: [],
      project_suppliers: [],
    },
  }
  return {
    ...unsigned,
    sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(unsigned)).digest('hex'),
  }
}

function backup(source: CoreMigrationSourceDTO): CoreMigrationBackupAttestationDTO {
  return {
    backupId: `core-migration-${source.sourceHash}-${'c'.repeat(64)}`,
    sourceHash: source.sourceHash,
    sourceVersion: source.sourceVersion,
    snapshotSha256: 'c'.repeat(64),
    byteLength: 1024,
    createdAt: '2026-08-15T07:59:00.000Z',
    immutable: true,
  }
}

function sourceCommand(
  commandId: string,
  source: CoreMigrationSourceDTO,
  attestation: CoreMigrationBackupAttestationDTO | null = null,
): CoreMigrationSourceCommandDTO {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: CORE_MIGRATION_CAPABILITY,
    commandId,
    source,
    backup: attestation,
  }
}

function batchCommand(commandId: string, batchId: string): CoreMigrationBatchCommandDTO {
  return {
    workspaceId: SESSION.workspaceId,
    actorId: SESSION.actorId,
    requiredCapability: CORE_MIGRATION_CAPABILITY,
    commandId,
    batchId,
  }
}

describe('核心迁移与项目正式读链', () => {
  it.each(['edited-imported-project', 'independent-project-reference'] as const)('真实owner阻止危险回滚且保留authority和回执：%s', async (scenario) => {
    const actor = { ...SESSION, capabilities: [...SESSION.capabilities, 'project:write', 'customer:write'] }
    const customer = createCustomerCommandTestInstance()
    const project = createProjectCommandTestInstance({ createId: () => 'independent-project' })
    const migration = createCoreMigrationTestInstance({
      createServerId: ({ entityType, legacyId }) => `server:${entityType}:${legacyId}`,
      prepareTransition: (next, _workspaceId, previous) => prepareCoreMigrationCommandSources(next, [customer, project], [], previous),
    })
    const source = migrationSource()
    await migration.preflight(sourceCommand('protected-preflight', source), actor)
    const dryRun = await migration.dryRun(sourceCommand('protected-dry', source, backup(source)), actor)
    await migration.importBatch(batchCommand('protected-import', dryRun.batchId), actor)
    await migration.confirm(batchCommand('protected-confirm', dryRun.batchId), actor)
    const id = 'server:projects:project-local-1'
    const imported = project.form(id, actor)
    const { id: _importedId, ...newDraft } = imported.draft
    const command = {
      workspaceId: actor.workspaceId,
      actorId: actor.actorId,
      requiredCapability: 'project:write' as const,
      commandId: `protected-${scenario}`,
      action: 'draft' as const,
      attachments: {},
      ...(scenario === 'edited-imported-project' ? { id, baseVersion: imported.version } : { baseVersion: null }),
      draft: { ...(scenario === 'edited-imported-project' ? imported.draft : newDraft), name: '回滚须保全的后续事实' },
    }
    const saved = await project.execute(command, actor)
    const before = migration.snapshot(actor)
    await expect(migration.rollback(batchCommand(`rollback-${scenario}`, dryRun.batchId), actor)).rejects.toThrow(/后来修改|仍引用迁入/)
    expect(migration.snapshot(actor)).toEqual(before)
    expect(project.form(saved.id, actor)).toMatchObject({ version: saved.version, draft: { name: '回滚须保全的后续事实' } })
    expect(project.resolve(saved.commandId, actor)).toEqual({ outcome: 'applied', result: saved })
    expect(customer.form('server:customers:customer-local-1', actor).draft.name).toBe('迁移客户')
  })

  it('只在用户确认切换后展示迁移项目，回滚后撤回', async () => {
    const migration = createCoreMigrationTestInstance({
      now: () => '2026-08-15T08:00:00.000Z',
      createServerId: ({ entityType, legacyId }) => `server:${entityType}:${legacyId}`,
    })
    const projects = createProjectReadTestInstance(
      () => ['project:list:read'],
      () => [],
      () => 'project-command-empty',
      () => migration.snapshot(SESSION),
    )

    const source = migrationSource()
    await migration.preflight(sourceCommand('preflight', source), SESSION)
    const dryRun = await migration.dryRun(sourceCommand('dry-run', source, backup(source)), SESSION)
    await migration.importBatch(batchCommand('import', dryRun.batchId), SESSION)
    await expect(projects.list(undefined)).resolves.toMatchObject({ items: [] })

    await migration.confirm(batchCommand('confirm', dryRun.batchId), SESSION)
    const confirmed = await projects.list(undefined)
    expect(confirmed.items).toContainEqual(expect.objectContaining({
      dataOrigin: 'real',
      project: expect.objectContaining({
        id: 'server:projects:project-local-1',
        label: '迁移项目',
      }),
      contractAmount: '8800.00',
      customer: expect.objectContaining({
        id: 'server:customers:customer-local-1',
        label: '迁移客户',
      }),
    }))

    await migration.rollback(batchCommand('rollback', dryRun.batchId), SESSION)
    await expect(projects.list(undefined)).resolves.toMatchObject({ items: [] })
  })
})
