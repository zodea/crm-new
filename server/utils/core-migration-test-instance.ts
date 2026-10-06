import type {
  CoreMigrationBackupAttestationDTO,
  CoreMigrationBatchCommandDTO,
  CoreMigrationBatchDTO,
  CoreMigrationEntityType,
  CoreMigrationIdMappingDTO,
  CoreMigrationIssueDTO,
  CoreMigrationPreflightDTO,
  CoreMigrationReferenceField,
  CoreMigrationServerEntityDTO,
  CoreMigrationServerIdInput,
  CoreMigrationSnapshotDTO,
  CoreMigrationSourceCommandDTO,
  CoreMigrationSourceDTO,
  CoreMigrationSourceEntityDTO,
  CoreMigrationSourceRefDTO,
} from '../../app/lib/migration/core-contract'
import type { BusinessSession } from './business-session'
import type { CommandJournal } from './command-journal'
import type { PreparedCoreMigration } from './core-migration-preparation'
import { createHash } from 'node:crypto'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SUPPORTED_SOURCE_VERSIONS,
  CORE_MIGRATION_TOPOLOGY,
  coreMigrationCentsToMoney,
  coreMigrationMoneyToCents,
  coreMigrationSourceHashInput,
  isCoreMigrationBlockingIssue,
} from '../../app/lib/migration/core-contract'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { auxiliaryContractInstance } from './auxiliary-contract-runtime'
import { commandJournalKey, commandReplay, parseResolveCommandBody, resolveJournalCommand } from './command-journal'
import { constructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { prepareCoreMigrationCommandSources } from './core-migration-preparation'
import { crewWorkerCommandTestInstance } from './crew-worker-command-test-instance'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { deliveryCommandTestInstance } from './delivery-runtime'
import { materialContractCommandTestInstance } from './material-contract-command-test-instance'
import { migratedOtherSettlement } from './other-settlement-migration'
import { otherSettlementInstance } from './other-settlement-runtime'
import { migratedSettlementSource } from './other-settlement-sources'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { planPayrollMigration } from './payroll-migration'
import { prepareProcessLibraryMigration } from './process-library-migration'
import { processLibraryService, processLibrarySession } from './process-library-runtime'
import { projectCommandTestInstance } from './project-command-test-instance'
import { planQuantityMigration } from './quantity-migration'
import { quantityTestInstance } from './quantity-runtime'
import { receiptCommandTestInstance } from './receipt-command-service'
import { subcontractContractCommandTestInstance } from './subcontract-contract-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'
import { prepareSupplierCredentialMigration } from './supplier-credential-migration'
import { planBudgetMigration } from './target-cost-migration'
import { planWbsMigration } from './wbs-migration'

const DEFAULT_ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000

type Operation = 'preflight' | 'dry-run' | 'import' | 'confirm' | 'rollback'
type CommandResult = CoreMigrationPreflightDTO | CoreMigrationBatchDTO

interface StoredCommand {
  operation: Operation
  result: CommandResult
}

interface BatchBackup {
  authority: CoreMigrationSnapshotDTO['authority']
  activeBatchId: string | null
  entities: CoreMigrationServerEntityDTO[]
}

interface StoredBatch {
  dto: CoreMigrationBatchDTO
  sourceFingerprint: string
  plannedEntities: CoreMigrationServerEntityDTO[]
  attestation: CoreMigrationBackupAttestationDTO
  backup: BatchBackup | null
}

interface WorkspaceState extends CommandJournal<StoredCommand> {
  authority: CoreMigrationSnapshotDTO['authority']
  activeBatchId: string | null
  entities: CoreMigrationServerEntityDTO[]
  batches: Map<string, StoredBatch>
  batchBySourceHash: Map<string, string>
  preflightSourceHashes: Set<string>
  commands: Map<string, StoredCommand>
}

export interface CoreMigrationTestInstanceOptions {
  now?: () => string
  createServerId?: (input: CoreMigrationServerIdInput) => string
  rollbackWindowMs?: number
  beforeCommit?: (entity: CoreMigrationServerEntityDTO) => void | Promise<void>
  afterApply?: (entities: CoreMigrationServerEntityDTO[], batchId: string) => void | Promise<void>
  afterConfirm?: (snapshot: CoreMigrationSnapshotDTO, batchId: string) => void | Promise<void>
  afterRollback?: (snapshot: CoreMigrationSnapshotDTO, batchId: string) => void | Promise<void>
  afterReset?: (snapshot: CoreMigrationSnapshotDTO, workspaceId?: string) => void | Promise<void>
  prepareTransition?: (snapshot: CoreMigrationSnapshotDTO, workspaceId?: string, previousSnapshot?: CoreMigrationSnapshotDTO) => Promise<PreparedCoreMigration>
}

interface ReferenceRule {
  field: CoreMigrationReferenceField
  target: CoreMigrationEntityType | readonly CoreMigrationEntityType[]
  orphanWhenMissing?: boolean
  requiredSourceValue?: boolean
}

const REFERENCE_RULES: Partial<Record<CoreMigrationEntityType, readonly ReferenceRule[]>> = {
  payroll_projects: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true, requiredSourceValue: true },
  ],
  target_cost_versions: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
  ],
  supplier_credentials: [
    { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true, requiredSourceValue: true },
  ],
  quantity_projects: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true, requiredSourceValue: true },
  ],
  wbs_projects: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true, requiredSourceValue: true },
  ],
  delivery_records: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true, requiredSourceValue: true },
    { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true },
  ],
  other_settlements: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true },
    { field: 'contractId', target: 'auxiliary_contracts', orphanWhenMissing: true },
  ],
  projects: [
    { field: 'customerId', target: 'customers' },
    { field: 'secondaryCustomerId', target: 'customers' },
  ],
  construction_contracts: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'customerId', target: 'customers' },
  ],
  subcontract_contracts: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true },
  ],
  material_contracts: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true },
  ],
  auxiliary_contracts: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true },
  ],
  contract_supplements: [
    {
      field: 'contractId',
      target: ['construction_contracts', 'subcontract_contracts', 'material_contracts'],
      orphanWhenMissing: true,
    },
  ],
  receipt_registrations: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'contractId', target: 'construction_contracts', orphanWhenMissing: true },
    { field: 'customerId', target: 'customers', orphanWhenMissing: true },
  ],
  owner_documents: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'contractId', target: 'construction_contracts', orphanWhenMissing: true },
    { field: 'supplierId', target: 'suppliers' },
  ],
  workers: [
    { field: 'crewId', target: 'crews' },
    { field: 'projectId', target: 'projects' },
  ],
  project_suppliers: [
    { field: 'projectId', target: 'projects', orphanWhenMissing: true },
    { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true },
  ],
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableDefaultId(input: CoreMigrationServerIdInput): string {
  return `core-${input.entityType}-${digest([
    input.workspaceId,
    input.sourceHash,
    input.entityType,
    input.legacyId,
  ].join('\u001F')).slice(0, 24)}`
}

function invalid(message: string): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem(projectProblem('validation-failed', message))
}

function forbidden(message: string): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem(projectProblem('forbidden', message))
}

function conflict(message: string): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem(projectProblem('conflict', message))
}

function notFound(message: string): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem(projectProblem('not-found', message))
}

function moneyCents(value: string | null | undefined): bigint {
  return value == null ? BigInt(0) : coreMigrationMoneyToCents(value)
}

function moneyDifference(actual: string | null, expected: string | null): string {
  return coreMigrationCentsToMoney(moneyCents(actual) - moneyCents(expected))
}

function freshWorkspace(): WorkspaceState {
  return {
    authority: 'local',
    activeBatchId: null,
    entities: [],
    batches: new Map(),
    batchBySourceHash: new Map(),
    preflightSourceHashes: new Set(),
    commands: new Map(),
    commandFingerprints: new Map(),
    sealedCommands: new Set(),
  }
}

function entityKey(entityType: CoreMigrationEntityType, legacyId: string): string {
  return `${entityType}\u001F${legacyId}`
}

function referenceTargets(rule: ReferenceRule): readonly CoreMigrationEntityType[] {
  return typeof rule.target === 'string' ? [rule.target] : rule.target
}

function isOwnerDocumentDryRunRelationshipBlock(issue: CoreMigrationIssueDTO): boolean {
  return ['owner_documents', 'other_settlements', 'other_settlement_sources'].includes(issue.entityType)
    && (issue.metricKey === 'orphan' || issue.metricKey === 'missing-relation')
    && ['projectId', 'contractId', 'supplierId'].includes(issue.field)
}

function referenceRulesFor(
  entityType: CoreMigrationEntityType,
  attributes: CoreMigrationSourceEntityDTO['attributes'],
): readonly ReferenceRule[] {
  if (entityType === 'other_settlement_sources' && attributes?.kind === 'application')
    return REFERENCE_RULES.other_settlements!
  if (entityType === 'other_settlement_sources')
    return [{ field: 'projectId', target: 'projects', orphanWhenMissing: true }, { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true }]
  if (entityType === 'owner_documents' && attributes?.kind === 'project_penalty') {
    return [
      { field: 'projectId', target: 'projects', orphanWhenMissing: true, requiredSourceValue: true },
      { field: 'supplierId', target: 'suppliers' },
      { field: 'contractId', target: attributes.contractKind === 'other_expense' ? 'auxiliary_contracts' : 'subcontract_contracts' },
      { field: 'crewId', target: 'crews' },
    ]
  }
  if (entityType === 'owner_documents' && (attributes?.kind === 'sub_change' || attributes?.kind === 'sub_settlement')) {
    return [
      { field: 'projectId', target: 'projects', orphanWhenMissing: true, requiredSourceValue: true },
      { field: 'supplierId', target: 'suppliers', orphanWhenMissing: true, requiredSourceValue: true },
      { field: 'contractId', target: 'subcontract_contracts', orphanWhenMissing: true, requiredSourceValue: true },
    ]
  }
  return REFERENCE_RULES[entityType] ?? []
}

function hasSameAttestation(
  left: CoreMigrationBackupAttestationDTO,
  right: CoreMigrationBackupAttestationDTO,
): boolean {
  return left.backupId === right.backupId
    && left.sourceHash === right.sourceHash
    && left.sourceVersion === right.sourceVersion
    && left.snapshotSha256 === right.snapshotSha256
    && left.byteLength === right.byteLength
    && left.createdAt === right.createdAt
    && left.immutable === right.immutable
}

export function createCoreMigrationTestInstance(options: CoreMigrationTestInstanceOptions = {}) {
  const workspaces = new Map<string, WorkspaceState>()
  const now = options.now ?? (() => new Date().toISOString())
  const createServerId = options.createServerId ?? stableDefaultId
  const rollbackWindowMs = options.rollbackWindowMs ?? DEFAULT_ROLLBACK_WINDOW_MS
  const queues = new Map<string, Promise<void>>()
  let resetting: Promise<void> = Promise.resolve()

  function enqueue<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const pending = Promise.all([resetting, queues.get(workspaceId)]).then(work)
    queues.set(workspaceId, pending.then(() => undefined, () => undefined))
    return pending
  }

  function commandQueue<T, Request extends CoreMigrationSourceCommandDTO | CoreMigrationBatchCommandDTO>(request: Request, session: BusinessSession, operation: (command: Request, session: BusinessSession) => Promise<T>): Promise<T> {
    const command = clone(request)
    const actor = clone(session)
    return enqueue(actor.workspaceId, () => operation(command, actor))
  }

  async function commitTransition(snapshot: CoreMigrationSnapshotDTO, workspaceId: string | undefined, beforeCommit: () => void | Promise<void>, commitAuthority: () => void) {
    let prepared: PreparedCoreMigration | undefined
    try {
      const current = workspaceId ? workspace(workspaceId) : undefined
      const previousSnapshot = current ? clone({ authority: current.authority, activeBatchId: current.activeBatchId, entities: current.entities }) : undefined
      prepared = await options.prepareTransition?.(snapshot, workspaceId, previousSnapshot)
      await beforeCommit()
      prepared?.commit()
      commitAuthority()
    }
    catch (cause) {
      await prepared?.abort()
      throw cause
    }
  }

  function workspace(workspaceId: string): WorkspaceState {
    let state = workspaces.get(workspaceId)
    if (!state) {
      state = freshWorkspace()
      workspaces.set(workspaceId, state)
    }
    return state
  }

  function authorize(
    command: CoreMigrationSourceCommandDTO | CoreMigrationBatchCommandDTO,
    session: BusinessSession,
  ): WorkspaceState {
    if (command.workspaceId !== session.workspaceId
      || command.actorId !== session.actorId
      || command.requiredCapability !== CORE_MIGRATION_CAPABILITY
      || !session.capabilities.includes(CORE_MIGRATION_CAPABILITY)) {
      throw forbidden('当前会话无权执行核心数据迁移')
    }
    return workspace(session.workspaceId)
  }

  function replay<T extends CommandResult>(
    state: WorkspaceState,
    command: CoreMigrationSourceCommandDTO | CoreMigrationBatchCommandDTO,
    session: BusinessSession,
    operation: Operation,
  ): T | null {
    const stored = commandReplay(state, { ...command, operation }, session, 'core-migration', conflict).previous
    if (!stored)
      return null
    if (stored.operation !== operation)
      throw conflict('commandId 已用于其他迁移操作')
    return clone(stored.result) as T
  }

  function remember(
    state: WorkspaceState,
    command: CoreMigrationSourceCommandDTO | CoreMigrationBatchCommandDTO,
    session: BusinessSession,
    operation: Operation,
    result: CommandResult,
  ): void {
    state.commands.set(commandJournalKey(command.commandId, session, 'core-migration'), { operation, result: clone(result) })
  }

  function assertSupported(source: CoreMigrationSourceDTO): void {
    if (source.contractVersion !== CORE_MIGRATION_CONTRACT_VERSION)
      throw invalid(`不支持的迁移契约版本：${source.contractVersion}`)
    if (source.mode !== CORE_MIGRATION_SOURCE_MODE)
      throw invalid(`不支持的迁移来源模式：${source.mode}`)
    if (!CORE_MIGRATION_SUPPORTED_SOURCE_VERSIONS.includes(source.sourceVersion as typeof CORE_MIGRATION_SUPPORTED_SOURCE_VERSIONS[number]))
      throw invalid(`不支持的本地数据版本：${source.sourceVersion}`)
  }

  function assertSourceHash(source: CoreMigrationSourceDTO): void {
    const actual = digest(coreMigrationSourceHashInput(source))
    if (source.sourceHash !== actual)
      throw invalid('sourceHash 与服务端重算的来源内容不一致')
  }

  function assertPreflightCommand(command: CoreMigrationSourceCommandDTO): void {
    assertSupported(command.source)
    assertSourceHash(command.source)
    if (command.backup !== null)
      throw invalid('预检阶段不得附带备份证明')
  }

  function assertDryRunCommand(
    state: WorkspaceState,
    command: CoreMigrationSourceCommandDTO,
  ): CoreMigrationBackupAttestationDTO {
    assertSupported(command.source)
    assertSourceHash(command.source)
    if (!state.preflightSourceHashes.has(command.source.sourceHash))
      throw conflict('必须先对同一来源完成预检')
    const backup = command.backup
    if (!backup)
      throw invalid('dry-run 必须附带不可变备份证明')
    if (backup.sourceHash !== command.source.sourceHash
      || backup.sourceVersion !== command.source.sourceVersion) {
      throw invalid('备份证明与迁移来源不匹配')
    }
    if (backup.backupId
      !== `core-migration-${command.source.sourceHash}-${backup.snapshotSha256}`) {
      throw invalid('备份 ID 必须由 canonical 来源哈希与整库字节摘要共同确定')
    }
    return clone(backup)
  }

  function issue(
    batchId: string,
    commandId: string,
    sequence: number,
    values: Omit<CoreMigrationIssueDTO, 'id' | 'batchId' | 'commandId'>,
  ): CoreMigrationIssueDTO {
    return {
      id: `core-issue-${digest(`${batchId}\u001F${sequence}\u001F${values.entityType}\u001F${values.legacyId}\u001F${values.field}`).slice(0, 24)}`,
      batchId,
      commandId,
      ...values,
    }
  }

  function plan(
    command: CoreMigrationSourceCommandDTO,
    batchId: string,
    createdAt: string,
    attestation: CoreMigrationBackupAttestationDTO,
  ): StoredBatch {
    const mappings: CoreMigrationIdMappingDTO[] = []
    const mappingByLegacy = new Map<string, string>()
    const sourceRefs: CoreMigrationSourceRefDTO[] = []
    const issues: CoreMigrationIssueDTO[] = []
    const plannedEntities: CoreMigrationServerEntityDTO[] = []
    const steps: CoreMigrationBatchDTO['steps'] = []
    let issueSequence = 0

    for (const entityType of CORE_MIGRATION_TOPOLOGY) {
      const rows = command.source.entities[entityType] ?? []
      const seenLegacyIds = new Set<string>()
      let imported = 0

      for (const row of rows) {
        let skipped = false
        if (seenLegacyIds.has(row.legacyId)) {
          skipped = true
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType,
            legacyId: row.legacyId,
            serverId: null,
            field: 'legacyId',
            metricKey: 'duplicate-source',
            sourceValue: row.legacyId,
            expectedValue: 1,
            actualValue: 2,
            difference: 1,
            attribution: 'source',
            reason: '同一实体类型存在重复旧 ID',
          }))
        }
        seenLegacyIds.add(row.legacyId)

        if (row.quantity != null && row.quantity < 0) {
          skipped = true
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType,
            legacyId: row.legacyId,
            serverId: null,
            field: 'quantity',
            metricKey: 'quantity',
            sourceValue: String(row.quantity),
            expectedValue: 0,
            actualValue: row.quantity,
            difference: row.quantity,
            attribution: 'source',
            reason: 'quantity不能为负数',
          }))
        }
        if (row.amount != null && moneyCents(row.amount) < BigInt(0)) {
          skipped = true
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType,
            legacyId: row.legacyId,
            serverId: null,
            field: 'amount',
            metricKey: 'amount',
            sourceValue: row.amount,
            expectedValue: '0.00',
            actualValue: row.amount,
            difference: row.amount,
            attribution: 'source',
            reason: 'amount不能为负数',
          }))
        }

        const resolvedReferences: CoreMigrationServerEntityDTO['references'] = {}
        for (const rule of referenceRulesFor(entityType, row.attributes)) {
          const legacyReference = row.references?.[rule.field]
          if (legacyReference === undefined || legacyReference === null) {
            resolvedReferences[rule.field] = legacyReference ?? null
            if (rule.requiredSourceValue) {
              skipped = true
              issues.push(issue(batchId, command.commandId, issueSequence++, {
                entityType,
                legacyId: row.legacyId,
                serverId: null,
                field: rule.field,
                metricKey: 'orphan',
                sourceValue: '',
                expectedValue: null,
                actualValue: null,
                difference: null,
                attribution: 'missing-source',
                reason: `缺少必需的 ${rule.field} 显式旧 ID，拒绝导入`,
              }))
            }
            continue
          }
          const targetIds = referenceTargets(rule)
            .map(target => mappingByLegacy.get(entityKey(target, legacyReference)))
            .filter((targetId): targetId is string => Boolean(targetId))
          if (targetIds.length === 1) {
            resolvedReferences[rule.field] = targetIds[0]
            continue
          }
          if (rule.orphanWhenMissing)
            skipped = true
          resolvedReferences[rule.field] = null
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType,
            legacyId: row.legacyId,
            serverId: null,
            field: rule.field,
            metricKey: rule.orphanWhenMissing ? 'orphan' : 'missing-relation',
            sourceValue: legacyReference,
            expectedValue: null,
            actualValue: null,
            difference: null,
            attribution: 'missing-source',
            reason: targetIds.length > 1
              ? `显式旧 ID 同时命中多个 ${referenceTargets(rule).join(' / ')}，拒绝猜测父类型`
              : `找不到显式旧 ID 对应的 ${referenceTargets(rule).join(' / ')}，未按名称猜测`,
          }))
        }

        if (
          entityType === 'owner_documents'
          && (row.attributes?.kind === 'sub_change' || row.attributes?.kind === 'sub_settlement' || row.attributes?.kind === 'project_penalty')
          && resolvedReferences.contractId
          && resolvedReferences.projectId
          && resolvedReferences.supplierId
        ) {
          const contract = plannedEntities.find(entity =>
            entity.entityType === 'subcontract_contracts'
            && entity.id === resolvedReferences.contractId,
          )
          if (
            contract
            && (
              contract.references.projectId !== resolvedReferences.projectId
              || contract.references.supplierId !== resolvedReferences.supplierId
            )
          ) {
            skipped = true
            issues.push(issue(batchId, command.commandId, issueSequence++, {
              entityType,
              legacyId: row.legacyId,
              serverId: null,
              field: 'contractId',
              metricKey: 'missing-relation',
              sourceValue: row.references?.contractId ?? '',
              expectedValue: null,
              actualValue: null,
              difference: null,
              attribution: 'missing-source',
              reason: '分包变洽签与分包合同的项目或分供方关系不一致，拒绝导入',
            }))
          }
        }

        if (entityType === 'delivery_records' && row.attributes?.sourceProblem) {
          skipped = true
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType,
            legacyId: row.legacyId,
            serverId: null,
            field: 'original',
            metricKey: 'apply-failed',
            sourceValue: '',
            expectedValue: null,
            actualValue: null,
            difference: null,
            attribution: 'source',
            reason: String(row.attributes.sourceProblem),
          }))
        }
        if (skipped) {
          sourceRefs.push({
            batchId,
            sourceHash: command.source.sourceHash,
            entityType,
            legacyId: row.legacyId,
            serverId: null,
          })
          continue
        }

        const serverId = createServerId({
          workspaceId: command.workspaceId,
          sourceHash: command.source.sourceHash,
          entityType,
          legacyId: row.legacyId,
        })
        mappingByLegacy.set(entityKey(entityType, row.legacyId), serverId)
        mappings.push({ entityType, legacyId: row.legacyId, serverId })
        sourceRefs.push({
          batchId,
          sourceHash: command.source.sourceHash,
          entityType,
          legacyId: row.legacyId,
          serverId,
        })
        plannedEntities.push({
          entityType,
          id: serverId,
          legacyId: row.legacyId,
          name: row.name,
          references: resolvedReferences,
          quantity: row.quantity ?? null,
          amount: row.amount ?? null,
          attributes: clone(row.attributes ?? {}),
          deletedAt: row.deletedAt ?? null,
          batchId,
        })
        imported += 1

        if (entityType === 'delivery_records') {
          const legacyOriginals = JSON.parse(String(row.attributes?.legacyOriginalsJson || '[]')) as unknown[]
          const notices = [
            ...(row.attributes?.sourceState === 'missing' ? [{ metricKey: 'missing-original' as const, reason: '原件正文缺失，保留缺失状态；不代表到货、库存或结算资格' }] : []),
            ...(row.attributes?.auditJson && row.attributes.auditJson !== '[]' ? [{ metricKey: 'legacy-audit' as const, reason: '旧审计原样留痕；无法重建的历史版本不得冒称完整修订历史' }] : []),
            ...(legacyOriginals.length ? [{ metricKey: 'legacy-audit' as const, reason: `${legacyOriginals.length} 份历史原件已有逻辑 owner，按原字节与摘要保全；历史祖先及对应修订未核实，暂不开放正文。缺正文仍保留缺失，原库与不可变备份保留。` }] : []),
          ]
          for (const notice of notices) {
            issues.push(issue(batchId, command.commandId, issueSequence++, {
              entityType,
              legacyId: row.legacyId,
              serverId,
              field: 'provenance',
              metricKey: notice.metricKey,
              sourceValue: '',
              expectedValue: null,
              actualValue: null,
              difference: null,
              attribution: 'source',
              reason: notice.reason,
            }))
          }
        }

        if (row.deletedAt) {
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType,
            legacyId: row.legacyId,
            serverId,
            field: 'deletedAt',
            metricKey: 'soft-delete',
            sourceValue: row.deletedAt,
            expectedValue: null,
            actualValue: null,
            difference: null,
            attribution: 'source',
            reason: '软删除状态已保留',
          }))
        }
      }

      steps.push({
        entityType,
        sourceCount: rows.length,
        importableCount: imported,
        skippedCount: rows.length - imported,
      })
    }

    for (const entity of plannedEntities.filter(row => ['other_settlements', 'other_settlement_sources'].includes(row.entityType) && !row.deletedAt)) {
      try {
        if (entity.entityType === 'other_settlements')
          migratedOtherSettlement(entity, batchId, plannedEntities)
        else
          migratedSettlementSource(entity, plannedEntities)
      }
      catch (cause) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: entity.entityType,
          legacyId: entity.legacyId,
          serverId: entity.id,
          field: 'contractId',
          metricKey: 'missing-relation',
          sourceValue: entity.references.contractId ?? '',
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'missing-source',
          reason: cause instanceof Error ? cause.message : '结算迁移校验失败',
        }))
      }
    }

    try {
      prepareSupplierCredentialMigration([], { authority: 'central', activeBatchId: batchId, entities: plannedEntities })
    }
    catch (cause) {
      const entity = plannedEntities.find(row => row.entityType === 'supplier_credentials')
      if (entity) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: 'supplier_credentials',
          legacyId: entity.legacyId,
          serverId: entity.id,
          field: 'graphJson',
          metricKey: 'apply-failed',
          sourceValue: entity.legacyId,
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'source',
          reason: cause instanceof Error ? cause.message : '证照完整来源图校验失败',
        }))
      }
    }
    try {
      prepareProcessLibraryMigration([], { authority: 'central', activeBatchId: batchId, entities: plannedEntities })
    }
    catch (cause) {
      const entity = plannedEntities.find(row => row.entityType === 'process_libraries')
      if (entity) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: 'process_libraries',
          legacyId: entity.legacyId,
          serverId: entity.id,
          field: 'graphJson',
          metricKey: 'apply-failed',
          sourceValue: entity.legacyId,
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'source',
          reason: cause instanceof Error ? cause.message : '工序库完整来源图校验失败',
        }))
      }
    }

    for (const entity of plannedEntities.filter(row => row.entityType === 'quantity_projects')) {
      try {
        const plan = planQuantityMigration({ authority: 'central', activeBatchId: batchId, entities: plannedEntities.filter(row => row.entityType !== 'quantity_projects' || row.id === entity.id) }, new Map())
        const graph = plan.incoming[0]!.graph
        const payloads = new Set(graph.tables.file_payloads.map(row => row.file_ref_id))
        const missing = graph.tables.file_refs.filter(row => !payloads.has(row.id)).length
        if (missing) {
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType: 'quantity_projects',
            legacyId: entity.legacyId,
            serverId: entity.id,
            field: 'graphJson',
            metricKey: 'missing-original',
            sourceValue: String(missing),
            expectedValue: null,
            actualValue: missing,
            difference: null,
            attribution: 'source',
            reason: `${missing} 份历史工程量照片缺少正文，保留原元数据和明确缺失状态，不借其他照片补齐。`,
          }))
        }
      }
      catch (cause) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: 'quantity_projects',
          legacyId: entity.legacyId,
          serverId: entity.id,
          field: 'graphJson',
          metricKey: 'apply-failed',
          sourceValue: entity.legacyId,
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'source',
          reason: cause instanceof Error ? cause.message : '工程量完整来源图校验失败',
        }))
      }
    }

    for (const entity of plannedEntities.filter(row => row.entityType === 'wbs_projects')) {
      try {
        const plan = planWbsMigration({ authority: 'central', activeBatchId: batchId, entities: plannedEntities.filter(row => row.entityType !== 'wbs_projects' || row.id === entity.id) }, new Map())
        const legacy = plan.incoming[0]!.graph.tables.schedule_task_floor_plans.filter(row => row.source_basis === 'provisional').length
        if (legacy) {
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType: 'wbs_projects',
            legacyId: entity.legacyId,
            serverId: entity.id,
            field: 'graphJson',
            metricKey: 'legacy-audit',
            sourceValue: String(legacy),
            expectedValue: null,
            actualValue: legacy,
            difference: null,
            attribution: 'missing-source',
            reason: `${legacy} 条旧暂估楼层保留原冻结数值及原快照，但旧库没有完整冻结单位、逐户来源与缺量信息；明确登记历史不足，不用当前模板或合同量补造。`,
          }))
        }
        const missingSnapshots = plan.incoming[0]!.graph.tables.schedule_tasks.filter(row => row.template_snapshot_json === null).length
        if (missingSnapshots) {
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType: 'wbs_projects',
            legacyId: entity.legacyId,
            serverId: entity.id,
            field: 'template_snapshot_json',
            metricKey: 'legacy-audit',
            sourceValue: String(missingSnapshots),
            expectedValue: null,
            actualValue: missingSnapshots,
            difference: null,
            attribution: 'missing-source',
            reason: `${missingSnapshots} 条旧任务缺少原冻结工序快照，保留原计划和空值，不以当前工序库补造历史。`,
          }))
        }
      }
      catch (cause) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: 'wbs_projects',
          legacyId: entity.legacyId,
          serverId: entity.id,
          field: 'graphJson',
          metricKey: 'apply-failed',
          sourceValue: entity.legacyId,
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'source',
          reason: cause instanceof Error ? cause.message : 'WBS 完整来源图校验失败',
        }))
      }
    }

    for (const entity of plannedEntities.filter(row => row.entityType === 'payroll_projects')) {
      try {
        const snapshot = { authority: 'central' as const, activeBatchId: batchId, entities: plannedEntities }
        const quantity = planQuantityMigration(snapshot, new Map())
        const plan = planPayrollMigration(snapshot, new Map(), quantity.incoming.flatMap(row => row.identities.map(identity => ({ ...identity, projectId: row.project.id }))))
        for (const diagnostic of plan.incoming.find(row => row.entityId === entity.id)!.diagnostics) {
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType: 'payroll_projects',
            legacyId: entity.legacyId,
            serverId: entity.id,
            field: 'payrollGraphJson',
            metricKey: 'legacy-audit',
            sourceValue: diagnostic.recordId ?? entity.legacyId,
            expectedValue: null,
            actualValue: null,
            difference: null,
            attribution: 'missing-source',
            reason: `${diagnostic.code}：${diagnostic.message}`,
          }))
        }
      }
      catch (cause) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: 'payroll_projects',
          legacyId: entity.legacyId,
          serverId: entity.id,
          field: 'payrollGraphJson',
          metricKey: 'apply-failed',
          sourceValue: entity.legacyId,
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'source',
          reason: cause instanceof Error ? cause.message : '工资完整项目图校验失败',
        }))
      }
    }
    for (const entity of plannedEntities.filter(row => row.entityType === 'target_cost_versions')) {
      try {
        // 整批验证同一项目的当前版本唯一性，不能将每版单独通过后交给 SQL 报错。
        const plan = planBudgetMigration({ authority: 'central', activeBatchId: batchId, entities: plannedEntities }, new Map())
        const graph = plan.incoming.find(row => row.entityId === entity.id)!.graph
        const missing = graph.files.filter(file => !graph.payloads.some(payload => payload.file_ref_id === file.id)).length
        if (missing) {
          issues.push(issue(batchId, command.commandId, issueSequence++, {
            entityType: 'target_cost_versions',
            legacyId: entity.legacyId,
            serverId: entity.id,
            field: 'budgetGraphJson',
            metricKey: 'legacy-audit',
            sourceValue: String(missing),
            expectedValue: null,
            actualValue: missing,
            difference: null,
            attribution: 'missing-source',
            reason: `${missing} 份历史预算附件缺少原件正文；保留原元数据和缺件状态，不读取旧本地路径或伪造文件。`,
          }))
        }
      }
      catch (cause) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: 'target_cost_versions',
          legacyId: entity.legacyId,
          serverId: entity.id,
          field: 'budgetGraphJson',
          metricKey: 'apply-failed',
          sourceValue: entity.legacyId,
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'source',
          reason: cause instanceof Error ? cause.message : '预算完整来源图校验失败',
        }))
      }
    }

    for (const [entityType, expected] of Object.entries(command.source.expectations?.counts ?? {})) {
      const actual = steps.find(step => step.entityType === entityType)?.importableCount ?? 0
      if (actual !== expected) {
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: entityType as CoreMigrationEntityType,
          legacyId: '',
          serverId: null,
          field: 'count',
          metricKey: 'count',
          sourceValue: String(expected),
          expectedValue: expected ?? 0,
          actualValue: actual,
          difference: actual - (expected ?? 0),
          attribution: 'mapping',
          reason: '可导入数量与来源期望不一致',
        }))
      }
    }

    for (const expectation of command.source.expectations?.totals ?? []) {
      if (expectation.metric === 'amount') {
        const actual = coreMigrationCentsToMoney(
          plannedEntities
            .filter(entity => entity.entityType === expectation.entityType)
            .reduce((sum, entity) => sum + moneyCents(entity.amount), BigInt(0)),
        )
        if (actual === expectation.expected)
          continue
        issues.push(issue(batchId, command.commandId, issueSequence++, {
          entityType: expectation.entityType,
          legacyId: '',
          serverId: null,
          field: 'amount',
          metricKey: 'amount',
          sourceValue: expectation.expected,
          expectedValue: expectation.expected,
          actualValue: actual,
          difference: moneyDifference(actual, expectation.expected),
          attribution: 'mapping',
          reason: '可导入汇总与来源期望不一致',
        }))
        continue
      }
      const actualRaw = plannedEntities
        .filter(entity => entity.entityType === expectation.entityType)
        .reduce((sum, entity) => sum + (entity.quantity ?? 0), 0)
      if (actualRaw === expectation.expected)
        continue
      issues.push(issue(batchId, command.commandId, issueSequence++, {
        entityType: expectation.entityType,
        legacyId: '',
        serverId: null,
        field: 'quantity',
        metricKey: 'quantity',
        sourceValue: String(expectation.expected),
        expectedValue: expectation.expected,
        actualValue: actualRaw,
        difference: actualRaw - expectation.expected,
        attribution: 'mapping',
        reason: '可导入汇总与来源期望不一致',
      }))
    }

    return {
      dto: {
        batchId,
        sourceVersion: command.source.sourceVersion,
        sourceHash: command.source.sourceHash,
        status: 'dry-run',
        authority: 'local',
        steps,
        mappings,
        sourceRefs,
        issues,
        createdAt,
        updatedAt: createdAt,
        rollbackExpiresAt: null,
        confirmedAt: null,
        rolledBackAt: null,
      },
      sourceFingerprint: digest(coreMigrationSourceHashInput(command.source)),
      plannedEntities,
      attestation,
      backup: null,
    }
  }

  function reconcileAppliedBatch(
    state: WorkspaceState,
    batch: StoredBatch,
    commandId: string,
  ): CoreMigrationIssueDTO[] {
    const retained = batch.dto.issues.filter(item => !item.reason.startsWith('写后对账：'))
    const actualEntities = state.entities.filter(entity => entity.batchId === batch.dto.batchId)
    const actualById = new Map(actualEntities.map(entity => [entity.id, entity]))
    const issues = [...retained]
    let sequence = issues.length
    const append = (values: Omit<CoreMigrationIssueDTO, 'id' | 'batchId' | 'commandId'>) => {
      issues.push(issue(batch.dto.batchId, commandId, sequence++, values))
    }

    for (const step of batch.dto.steps) {
      const actual = actualEntities.filter(entity => entity.entityType === step.entityType).length
      if (actual !== step.importableCount) {
        append({
          entityType: step.entityType,
          legacyId: '',
          serverId: null,
          field: 'count',
          metricKey: 'count',
          sourceValue: String(step.importableCount),
          expectedValue: step.importableCount,
          actualValue: actual,
          difference: actual - step.importableCount,
          attribution: 'system',
          reason: '写后对账：中央批次记录数量与计划不一致',
        })
      }
    }

    for (const planned of batch.plannedEntities) {
      const actual = actualById.get(planned.id)
      if (!actual) {
        append({
          entityType: planned.entityType,
          legacyId: planned.legacyId,
          serverId: planned.id,
          field: 'id',
          metricKey: 'apply-failed',
          sourceValue: planned.id,
          expectedValue: 1,
          actualValue: 0,
          difference: -1,
          attribution: 'system',
          reason: '写后对账：中央缺少计划导入的实体',
        })
        continue
      }
      if (planned.amount !== actual.amount) {
        append({
          entityType: planned.entityType,
          legacyId: planned.legacyId,
          serverId: planned.id,
          field: 'amount',
          metricKey: 'amount',
          sourceValue: planned.amount ?? '',
          expectedValue: planned.amount,
          actualValue: actual.amount,
          difference: moneyDifference(actual.amount, planned.amount),
          attribution: 'system',
          reason: '写后对账：中央 amount 与计划不一致',
        })
      }
      if (planned.quantity !== actual.quantity) {
        append({
          entityType: planned.entityType,
          legacyId: planned.legacyId,
          serverId: planned.id,
          field: 'quantity',
          metricKey: 'quantity',
          sourceValue: String(planned.quantity ?? ''),
          expectedValue: planned.quantity,
          actualValue: actual.quantity,
          difference: (actual.quantity ?? 0) - (planned.quantity ?? 0),
          attribution: 'system',
          reason: '写后对账：中央 quantity 与计划不一致',
        })
      }
      if (planned.deletedAt !== actual.deletedAt) {
        append({
          entityType: planned.entityType,
          legacyId: planned.legacyId,
          serverId: planned.id,
          field: 'deletedAt',
          metricKey: 'soft-delete-mismatch',
          sourceValue: planned.deletedAt ?? '',
          expectedValue: null,
          actualValue: null,
          difference: null,
          attribution: 'system',
          reason: '写后对账：中央软删除状态与计划不一致',
        })
      }
      for (const rule of referenceRulesFor(planned.entityType, planned.attributes)) {
        const expected = planned.references[rule.field] ?? null
        const observed = actual.references[rule.field] ?? null
        if (expected !== observed) {
          append({
            entityType: planned.entityType,
            legacyId: planned.legacyId,
            serverId: planned.id,
            field: rule.field,
            metricKey: 'missing-relation',
            sourceValue: expected ?? '',
            expectedValue: null,
            actualValue: null,
            difference: null,
            attribution: 'system',
            reason: '写后对账：中央关系与计划映射不一致',
          })
        }
        if (observed && !state.entities.some(entity => entity.id === observed && referenceTargets(rule).includes(entity.entityType))) {
          append({
            entityType: planned.entityType,
            legacyId: planned.legacyId,
            serverId: planned.id,
            field: rule.field,
            metricKey: rule.orphanWhenMissing ? 'orphan' : 'missing-relation',
            sourceValue: observed,
            expectedValue: null,
            actualValue: null,
            difference: null,
            attribution: 'system',
            reason: '写后对账：中央关系指向不存在的目标记录',
          })
        }
      }
    }
    const plannedIds = new Set(batch.plannedEntities.map(entity => entity.id))
    for (const actual of actualEntities) {
      if (plannedIds.has(actual.id))
        continue
      append({
        entityType: actual.entityType,
        legacyId: actual.legacyId,
        serverId: actual.id,
        field: 'id',
        metricKey: 'apply-failed',
        sourceValue: actual.id,
        expectedValue: 0,
        actualValue: 1,
        difference: 1,
        attribution: 'system',
        reason: '写后对账：中央出现计划外实体',
      })
    }
    return issues
  }

  async function preflight(
    command: CoreMigrationSourceCommandDTO,
    session: BusinessSession,
  ): Promise<CoreMigrationPreflightDTO> {
    const state = authorize(command, session)
    const previous = replay<CoreMigrationPreflightDTO>(state, command, session, 'preflight')
    if (previous)
      return previous
    assertPreflightCommand(command)
    const result: CoreMigrationPreflightDTO = {
      eligible: true,
      contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
      mode: CORE_MIGRATION_SOURCE_MODE,
      sourceVersion: command.source.sourceVersion,
      sourceHash: command.source.sourceHash,
      entityCount: CORE_MIGRATION_TOPOLOGY.reduce(
        (count, entityType) => count + (command.source.entities[entityType]?.length ?? 0),
        0,
      ),
    }
    state.preflightSourceHashes.add(command.source.sourceHash)
    remember(state, command, session, 'preflight', result)
    return clone(result)
  }

  async function dryRun(
    command: CoreMigrationSourceCommandDTO,
    session: BusinessSession,
  ): Promise<CoreMigrationBatchDTO> {
    const state = authorize(command, session)
    const previous = replay<CoreMigrationBatchDTO>(state, command, session, 'dry-run')
    if (previous)
      return previous
    const attestation = assertDryRunCommand(state, command)
    const fingerprint = digest(coreMigrationSourceHashInput(command.source))
    const existingBatchId = state.batchBySourceHash.get(command.source.sourceHash)
    if (existingBatchId) {
      const existing = state.batches.get(existingBatchId)
      if (!existing)
        throw new Error('core migration batch index is inconsistent')
      if (existing.sourceFingerprint !== fingerprint)
        throw conflict('相同 sourceHash 对应了不同来源内容')
      if (!hasSameAttestation(existing.attestation, attestation))
        throw conflict('相同来源不能替换已证明的不可变备份')
      remember(state, command, session, 'dry-run', existing.dto)
      return clone(existing.dto)
    }

    const batchId = `core-batch-${digest(`${command.workspaceId}\u001F${command.source.sourceHash}`).slice(0, 24)}`
    const stored = plan(command, batchId, now(), attestation)
    state.batches.set(batchId, stored)
    state.batchBySourceHash.set(command.source.sourceHash, batchId)
    remember(state, command, session, 'dry-run', stored.dto)
    return clone(stored.dto)
  }

  function storedBatch(state: WorkspaceState, batchId: string): StoredBatch {
    const batch = state.batches.get(batchId)
    if (!batch)
      throw notFound('迁移批次不存在')
    return batch
  }

  async function importBatch(
    command: CoreMigrationBatchCommandDTO,
    session: BusinessSession,
  ): Promise<CoreMigrationBatchDTO> {
    const state = authorize(command, session)
    const previous = replay<CoreMigrationBatchDTO>(state, command, session, 'import')
    if (previous)
      return previous
    const batch = storedBatch(state, command.batchId)
    if (batch.dto.status === 'applied' || batch.dto.status === 'confirmed') {
      remember(state, command, session, 'import', batch.dto)
      return clone(batch.dto)
    }
    if (batch.dto.status !== 'dry-run' && batch.dto.status !== 'failed')
      throw conflict(`状态 ${batch.dto.status} 不允许导入`)
    if (batch.dto.issues.some(item => ['quantity_projects', 'process_libraries', 'supplier_credentials', 'wbs_projects'].includes(item.entityType) && item.field === 'graphJson' && item.metricKey === 'apply-failed')
      || batch.dto.issues.some(item => item.entityType === 'target_cost_versions' && item.field === 'budgetGraphJson' && item.metricKey === 'apply-failed')
      || batch.dto.issues.some(item => item.entityType === 'payroll_projects' && item.field === 'payrollGraphJson' && item.metricKey === 'apply-failed')
      || (batch.dto.status === 'dry-run' && batch.dto.issues.some(isOwnerDocumentDryRunRelationshipBlock))) {
      throw conflict('dry-run 存在阻断问题，不能导入')
    }
    if (state.activeBatchId && state.activeBatchId !== command.batchId)
      throw conflict('已有另一迁移批次等待确认或回滚')

    const importedAt = now()
    const candidateEntities = state.entities.filter(entity => entity.batchId !== command.batchId)
    let failedEntity: CoreMigrationServerEntityDTO | null = null
    try {
      for (const entity of batch.plannedEntities) {
        failedEntity = entity
        await options.beforeCommit?.(clone(entity))
        candidateEntities.push(clone(entity))
        failedEntity = null
      }
      await options.afterApply?.(candidateEntities, command.batchId)
    }
    catch (cause) {
      const reason = cause instanceof Error ? cause.message : '未知导入错误'
      const failed: CoreMigrationBatchDTO = {
        ...batch.dto,
        status: 'failed',
        updatedAt: importedAt,
        issues: [
          ...batch.dto.issues.filter(item => item.metricKey !== 'apply-failed'),
          issue(command.batchId, command.commandId, batch.dto.issues.length, {
            entityType: failedEntity?.entityType ?? 'batch',
            legacyId: failedEntity?.legacyId ?? '',
            serverId: failedEntity?.id ?? null,
            field: failedEntity ? 'entity' : 'batch',
            metricKey: 'apply-failed',
            sourceValue: failedEntity?.legacyId ?? command.batchId,
            expectedValue: null,
            actualValue: null,
            difference: null,
            attribution: 'system',
            reason,
          }),
        ],
      }
      batch.dto = failed
      return clone(failed)
    }

    batch.backup = {
      authority: state.authority,
      activeBatchId: state.activeBatchId,
      entities: clone(state.entities),
    }
    state.entities = candidateEntities
    state.activeBatchId = command.batchId
    batch.dto = {
      ...batch.dto,
      status: 'applied',
      authority: state.authority,
      updatedAt: importedAt,
      rollbackExpiresAt: null,
      issues: batch.dto.issues.filter(item => item.metricKey !== 'apply-failed'),
    }
    batch.dto = {
      ...batch.dto,
      issues: reconcileAppliedBatch(state, batch, command.commandId),
    }
    remember(state, command, session, 'import', batch.dto)
    return clone(batch.dto)
  }

  async function confirm(
    command: CoreMigrationBatchCommandDTO,
    session: BusinessSession,
  ): Promise<CoreMigrationBatchDTO> {
    const state = authorize(command, session)
    const previous = replay<CoreMigrationBatchDTO>(state, command, session, 'confirm')
    if (previous)
      return previous
    const batch = storedBatch(state, command.batchId)
    if (batch.dto.status === 'confirmed') {
      remember(state, command, session, 'confirm', batch.dto)
      return clone(batch.dto)
    }
    if (batch.dto.status !== 'applied')
      throw conflict(`状态 ${batch.dto.status} 不允许确认切换`)
    if (state.activeBatchId !== command.batchId)
      throw conflict('中央当前活动批次与确认请求不一致')
    if (!batch.attestation)
      throw conflict('缺少不可变备份证明，不能确认切换')
    if (batch.dto.issues.some(isCoreMigrationBlockingIssue))
      throw conflict('存在阻塞性对账问题，不能确认切换')
    const confirmedAt = now()
    const confirmedBatch: CoreMigrationBatchDTO = {
      ...batch.dto,
      status: 'confirmed',
      authority: 'central',
      updatedAt: confirmedAt,
      confirmedAt,
      rollbackExpiresAt: new Date(Date.parse(confirmedAt) + rollbackWindowMs).toISOString(),
    }
    const nextSnapshot: CoreMigrationSnapshotDTO = {
      authority: 'central',
      activeBatchId: command.batchId,
      entities: clone(state.entities),
    }
    await commitTransition(nextSnapshot, session.workspaceId, () => options.afterConfirm?.(nextSnapshot, command.batchId), () => {
      state.authority = 'central'
      state.activeBatchId = command.batchId
      batch.dto = confirmedBatch
      remember(state, command, session, 'confirm', batch.dto)
    })
    return clone(batch.dto)
  }

  async function rollback(
    command: CoreMigrationBatchCommandDTO,
    session: BusinessSession,
  ): Promise<CoreMigrationBatchDTO> {
    const state = authorize(command, session)
    const previous = replay<CoreMigrationBatchDTO>(state, command, session, 'rollback')
    if (previous)
      return previous
    const batch = storedBatch(state, command.batchId)
    if (batch.dto.status === 'rolled-back') {
      remember(state, command, session, 'rollback', batch.dto)
      return clone(batch.dto)
    }
    if ((batch.dto.status !== 'applied' && batch.dto.status !== 'confirmed') || !batch.backup)
      throw conflict(`状态 ${batch.dto.status} 不允许回滚`)
    const rolledBackAt = now()
    if (batch.dto.status === 'confirmed'
      && (!batch.dto.rollbackExpiresAt
        || Date.parse(rolledBackAt) > Date.parse(batch.dto.rollbackExpiresAt))) {
      throw conflict('迁移回滚窗口已关闭')
    }
    const nextSnapshot: CoreMigrationSnapshotDTO = {
      authority: batch.backup.authority,
      activeBatchId: batch.backup.activeBatchId,
      entities: clone(batch.backup.entities),
    }
    await commitTransition(nextSnapshot, session.workspaceId, () => options.afterRollback?.(nextSnapshot, command.batchId), () => {
      state.authority = nextSnapshot.authority
      state.activeBatchId = nextSnapshot.activeBatchId
      state.entities = clone(nextSnapshot.entities)
      batch.dto = { ...batch.dto, status: 'rolled-back', authority: state.authority, updatedAt: rolledBackAt, rolledBackAt }
      remember(state, command, session, 'rollback', batch.dto)
    })
    return clone(batch.dto)
  }

  function snapshot(session: BusinessSession): CoreMigrationSnapshotDTO {
    if (!session.capabilities.includes(CORE_MIGRATION_CAPABILITY))
      throw forbidden('当前会话无权读取核心数据迁移状态')
    const state = workspace(session.workspaceId)
    return clone({
      authority: state.authority,
      activeBatchId: state.activeBatchId,
      entities: state.entities,
    })
  }

  async function reset(workspaceId?: string): Promise<void> {
    const empty: CoreMigrationSnapshotDTO = { authority: 'local', activeBatchId: null, entities: [] }
    await commitTransition(empty, workspaceId, () => options.afterReset?.(empty, workspaceId), () => {
      if (workspaceId)
        workspaces.delete(workspaceId)
      else
        workspaces.clear()
    })
  }

  return {
    preflight: (command: CoreMigrationSourceCommandDTO, session: BusinessSession) => commandQueue(command, session, preflight),
    dryRun: (command: CoreMigrationSourceCommandDTO, session: BusinessSession) => commandQueue(command, session, dryRun),
    importBatch: (command: CoreMigrationBatchCommandDTO, session: BusinessSession) => commandQueue(command, session, importBatch),
    confirm: (command: CoreMigrationBatchCommandDTO, session: BusinessSession) => commandQueue(command, session, confirm),
    rollback: (command: CoreMigrationBatchCommandDTO, session: BusinessSession) => commandQueue(command, session, rollback),
    resolve(commandId: string, session: BusinessSession) {
      parseResolveCommandBody({ commandId })
      if (!session.capabilities.includes(CORE_MIGRATION_CAPABILITY))
        throw forbidden('当前会话无权核对核心迁移原命令')
      return enqueue(session.workspaceId, async () => {
        if (!session.capabilities.includes(CORE_MIGRATION_CAPABILITY))
          throw forbidden('当前会话无权核对核心迁移原命令')
        const resolution = resolveJournalCommand(workspace(session.workspaceId), commandId, session, 'core-migration')
        return resolution.outcome === 'applied'
          ? { outcome: 'applied' as const, result: resolution.result.result }
          : resolution
      })
    },
    snapshot,
    reset(workspaceId?: string): Promise<void> {
      if (workspaceId)
        return enqueue(workspaceId, () => reset(workspaceId))
      const pending = Promise.all([resetting, ...queues.values()]).then(() => reset())
      resetting = pending.then(() => undefined, () => undefined)
      return pending
    },
  }
}

export interface CoreMigrationCommandSource {
  prepareMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO) => () => void
}

export function synchronizeCoreMigrationCommandSources(
  snapshot: CoreMigrationSnapshotDTO,
  sources: readonly CoreMigrationCommandSource[],
): void {
  const commits = sources.map(source => source.prepareMigrationSnapshot(snapshot))
  for (const commit of commits)
    commit()
}

const commandSources = [
  { prepareMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO) => processLibraryService.prepareMigrationSnapshot(snapshot, processLibrarySession()) },
  { prepareMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO) => auxiliaryContractInstance().prepareMigrationSnapshot(snapshot), assertMigrationRemoval: (removed: readonly CoreMigrationServerEntityDTO[]) => auxiliaryContractInstance().assertMigrationRemoval(removed) },
  { prepareMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO) => otherSettlementInstance().prepareMigrationSnapshot(snapshot), assertMigrationRemoval: (removed: readonly CoreMigrationServerEntityDTO[]) => otherSettlementInstance().assertMigrationRemoval(removed) },
  projectCommandTestInstance,
  customerCommandTestInstance,
  supplierCommandTestInstance,
  crewWorkerCommandTestInstance,
  constructionContractCommandTestInstance,
  subcontractContractCommandTestInstance,
  materialContractCommandTestInstance,
  receiptCommandTestInstance,
  deliveryCommandTestInstance,
  ownerCommercialDocumentCommandTestInstance,
] as const

export const coreMigrationTestInstance = createCoreMigrationTestInstance({
  prepareTransition: (snapshot, _workspaceId, previousSnapshot) => prepareCoreMigrationCommandSources(snapshot, commandSources, [quantityTestInstance], previousSnapshot),
})
