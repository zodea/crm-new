import type {
  ContractFormAttachment,
  ProjectContractFormDraft,
} from '../../app/lib/contract/forms'
import type {
  MaterialContractCommandRequestDTO,
  MaterialContractCommandResolutionDTO,
  MaterialContractCommandResultDTO,
  MaterialContractFormReadDTO,
} from '../../app/lib/material-contract/command-contract'
import type {
  MaterialContractDetailSource,
  MaterialContractFactSources,
  MaterialContractLineSource,
} from '../../app/lib/material-contract/repository'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { MaterialContractSourceGraph } from '../../app/lib/migration/material-contract-source'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/material-contract/command-contract'
import { decodeMaterialContractAttachment, decodeMaterialContractDraft } from '../../app/lib/material-contract/command-validation'
import { materialContractTotal, validateMaterialDetails, validateMaterialSourceOriginals } from '../../app/lib/material-contract/line-model'
import {
  materialContractProblem,
  MaterialContractRepositoryProblem,
} from '../../app/lib/material-contract/repository'
import { OurSignatoryRepositoryProblem } from '../../app/lib/our-signatory/contract'
import { resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { assertCommandUnsealed, commandFingerprint, commandJournalKey, commandReplay, resolveJournalCommand } from './command-journal'
import { contractMigratedAttachments } from './contract-original'
import { parseMaterialContractCommandRequest } from './material-contract-command-request'
import { materialMigratedLine, migratedMaterialContract } from './material-contract-migration'
import { materialOriginalBytes, materialOriginalDigest } from './material-contract-original'
import { developmentOurSignatoryOwner } from './our-signatory-runtime'
import { projectCommandTestInstance } from './project-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

interface ReferenceOption {
  id: string
  name: string
  contact?: string
  contactPhone?: string
}

export interface StoredMaterialContract {
  id: string
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: number
  createdAt: string
  updatedAt: string
  history: Array<{ draft: ProjectContractFormDraft & { id: string }, attachments: ContractFormAttachment[], version: number, updatedAt: string, actorId?: string, commandId?: string, action?: string }>
  migrationEvidence?: MaterialContractMigrationRecord
  migrationRetired?: boolean
  originalLineSnapshots?: Array<{ originalLineId: string, parentVersion: number | null, sourceUpdatedAt?: string, line: NonNullable<ProjectContractFormDraft['lineItems']>[number] }>
}

export interface MaterialContractMigrationRecord {
  id: string
  draft: ProjectContractFormDraft
  attachments?: ContractFormAttachment[]
  version?: number
  createdAt: string
  updatedAt: string
  history?: StoredMaterialContract['history']
  migrationBatchId?: string
  deletedAt?: string | null
  sourceGraph?: MaterialContractSourceGraph
  originalLineSnapshots?: StoredMaterialContract['originalLineSnapshots']
}

interface SessionState {
  commands: Map<string, MaterialContractCommandResultDTO>
  commandFingerprints: Map<string, string>
  sealedCommands: Set<string>
  requestEvidence: Map<string, MaterialContractCommandRequestDTO>
  contracts: Map<string, StoredMaterialContract>
  migratedProjects: Map<string, ReferenceOption>
  migratedSuppliers: Map<string, ReferenceOption>
  originals: Map<string, { bytes: Uint8Array, sha256: string }>
  sourceVersion: number
}

export interface MaterialContractOwnerSnapshot {
  schemaVersion: 1
  sourceVersion: number
  contracts: StoredMaterialContract[]
  commands: Array<[string, MaterialContractCommandResultDTO]>
  commandFingerprints: Array<[string, string]>
  sealedCommands: string[]
  requestEvidence: Array<[string, MaterialContractCommandRequestDTO]>
}

interface Options {
  createId?: () => string
  createLineId?: () => string
  createDeductionId?: () => string
  createAttachmentId?: () => string
  now?: () => string
  projects?: readonly ReferenceOption[]
  suppliers?: readonly ReferenceOption[]
  resolveProjects?: (sessionId?: string | null) => readonly ReferenceOption[]
  resolveSuppliers?: (sessionId?: string | null) => readonly ReferenceOption[]
  resolveSignatory?: (draft: ProjectContractFormDraft, existing: StoredMaterialContract | null, required: boolean, session: BusinessSession, sessionId?: string | null) => Promise<import('../../app/lib/our-signatory/contract').OurSignatorySnapshot | null>
  numberConflict?: (number: string, id: string | null) => Promise<boolean>
  validateDependencies?: (request: MaterialContractCommandRequestDTO, candidate: ProjectContractFormDraft, existing: StoredMaterialContract | null) => Promise<void>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function failure(
  code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict',
  message: string,
  fieldErrors: Record<string, string[]> = {},
) {
  return new MaterialContractRepositoryProblem({
    ...materialContractProblem(code, message),
    fieldErrors,
  })
}

export function createMaterialContractCommandTestInstance(options: Options = {}) {
  const states = new Map<string, SessionState>()
  const createId = options.createId ?? (() => randomUUID())
  const createLineId = options.createLineId ?? (() => randomUUID())
  const createDeductionId = options.createDeductionId ?? (() => randomUUID())
  const createAttachmentId = options.createAttachmentId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const legacyProjects = new Map((options.projects ?? []).map(row => [row.id, row.name]))
  const legacySuppliers = new Map((options.suppliers ?? []).map(row => [row.id, row.name]))
  const resolveProjects = options.resolveProjects ?? (() => [...legacyProjects].map(([id, name]) => ({ id, name })))
  const resolveSuppliers: NonNullable<Options['resolveSuppliers']> = options.resolveSuppliers ?? (() => [...legacySuppliers].map(([id, name]) => ({ id, name })))
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = {
        commands: new Map(),
        commandFingerprints: new Map(),
        sealedCommands: new Set(),
        requestEvidence: new Map(),
        contracts: new Map(),
        migratedProjects: new Map(),
        migratedSuppliers: new Map(),
        originals: new Map(),
        sourceVersion: 0,
      }
      states.set(key, state)
    }
    return state
  }

  function cleanDraft(
    source: ProjectContractFormDraft,
    id: string,
    existing: StoredMaterialContract | null,
    preserveSourceLineIds = false,
  ): ProjectContractFormDraft & { id: string } {
    const existingLineIds = new Set(preserveSourceLineIds
      ? (source.lineItems ?? []).map(row => text(row.id)).filter(Boolean)
      : existing?.draft.lineItems?.map(row => text(row.id)) ?? [])
    return {
      ...source,
      id,
      isSupplement: source.isSupplement === true,
      originalContractId: source.isSupplement ? text(source.originalContractId) || null : null,
      no: text(source.no),
      name: text(source.name),
      projectId: text(source.projectId) || null,
      customerId: null,
      supplierId: text(source.supplierId) || null,
      subKind: '',
      content: text(source.content),
      invoiceType: text(source.invoiceType),
      contactName: text(source.contactName),
      contactPhone: text(source.contactPhone),
      taxRate: number(source.taxRate),
      signDate: text(source.signDate),
      mainTerms: text(source.mainTerms),
      paymentTerms: text(source.paymentTerms),
      brandQualityTerms: text(source.brandQualityTerms),
      scheduleTerms: text(source.scheduleTerms),
      warrantyTerms: text(source.warrantyTerms),
      specialTerms: text(source.specialTerms),
      retentionRatio: number(source.retentionRatio),
      retentionAmount: number(source.retentionAmount),
      retentionDays: number(source.retentionDays),
      invoiceName: text(source.invoiceName),
      invoiceTaxNo: text(source.invoiceTaxNo),
      invoiceAddressPhone: text(source.invoiceAddressPhone),
      invoiceBank: text(source.invoiceBank),
      invoiceBankAccount: text(source.invoiceBankAccount),
      amount: number(source.amount),
      ourSignatoryId: source.ourSignatoryId ?? null,
      ourSignatoryVersion: source.ourSignatoryVersion ?? null,
      ourSignatorySnapshot: source.ourSignatorySnapshot ? structuredClone(source.ourSignatorySnapshot) : null,
      legacyPartyA: source.legacyPartyA ?? null,
      status: text(source.status) || '履约中',
      note: typeof source.note === 'string' ? source.note : '',
      lineItems: (source.lineItems ?? []).map((row, index) => ({
        id: existingLineIds.has(text(row.id)) ? text(row.id) : createLineId(),
        materialName: text(row.materialName),
        spec: text(row.spec),
        materialGrade: text(row.materialGrade),
        brand: text(row.brand),
        unit: text(row.unit),
        qty: number(row.qty),
        taxInclusiveUnitPrice: number(row.taxInclusiveUnitPrice),
        applicableTaxRate: number(row.applicableTaxRate),
        plannedArrivalDate: text(row.plannedArrivalDate),
        note: typeof row.note === 'string' ? row.note : '',
        sortOrder: index,
        originalLineId: text(row.originalLineId) || null,
        changeAmount: number(row.changeAmount),
        changeBasis: text(row.changeBasis),
        source: row.source ? structuredClone(row.source) : null,
      })),
      deductions: (source.deductions ?? []).map((row, index) => ({
        id: (preserveSourceLineIds || existing?.draft.deductions?.some(prior => prior.id === row.id)) && text(row.id) ? text(row.id) : createDeductionId(),
        name: text(row.name),
        amount: number(row.amount),
        basis: text(row.basis),
        sortOrder: index,
      })),
    }
  }

  function referenceMaps(sessionId?: string | null) {
    const state = stateFor(sessionId)
    return {
      projects: new Map([...state.migratedProjects.values(), ...resolveProjects(sessionId)].map(row => [row.id, row.name])),
      suppliers: new Map([...state.migratedSuppliers.values(), ...resolveSuppliers(sessionId)].map(row => [row.id, row.name])),
    }
  }

  function validate(
    draft: ProjectContractFormDraft,
    action: MaterialContractCommandRequestDTO['action'],
    sessionId?: string | null,
  ) {
    const state = stateFor(sessionId)
    const parent = draft.isSupplement && draft.originalContractId ? state.contracts.get(draft.originalContractId) : null
    if (draft.isSupplement && (!parent || parent.draft.isSupplement || !visible(parent)))
      throw failure('validation-failed', '原材料采购合同不存在或不是主合同', { originalContractId: ['请选择已存在的材料采购主合同'] })
    if (draft.isSupplement && action !== 'draft' && (number(draft.amount) == null || Number(draft.amount) <= 0))
      throw failure('validation-failed', '正式补充协议须记录明确的正增额', { amount: ['协议仅增加金额，本次增额必须大于 0'] })
    const { projects, suppliers } = referenceMaps(sessionId)
    const fieldErrors: Record<string, string[]> = {}
    if (action !== 'draft') {
      if (!text(draft.name))
        fieldErrors.name = ['合同名称为必填项']
      if (!text(draft.projectId))
        fieldErrors.projectId = ['项目为必填项']
      if (!text(draft.supplierId))
        fieldErrors.supplierId = ['分供方为必填项']
      if (!text(draft.content))
        fieldErrors.content = ['合同内容为必填项']
      if (!text(draft.signDate))
        fieldErrors.signDate = ['签约日期为必填项']
    }
    const amount = number(draft.amount)
    if (amount != null && amount < 0)
      fieldErrors.amount = ['含税合同金额不能为负数']
    const taxRate = number(draft.taxRate)
    if (taxRate != null && taxRate < 0)
      fieldErrors.taxRate = ['税率不能为负数']
    const retentionRatio = number(draft.retentionRatio)
    if (retentionRatio != null && (retentionRatio < 0 || retentionRatio > 1))
      fieldErrors.retentionRatio = ['质保金比例必须在 0 到 1 之间']
    const retentionAmount = number(draft.retentionAmount)
    if (retentionAmount != null && retentionAmount < 0)
      fieldErrors.retentionAmount = ['质保金金额不能为负数']
    const retentionDays = number(draft.retentionDays)
    if (retentionDays != null && retentionDays < 0)
      fieldErrors.retentionDays = ['质保期不能为负数']
    if (Object.keys(fieldErrors).length)
      throw failure('validation-failed', '材料采购合同表单校验失败', fieldErrors)
    if (text(draft.projectId) && !projects.has(text(draft.projectId)))
      throw failure('validation-failed', '项目不存在或来源不可用', { projectId: ['项目不存在'] })
    if (text(draft.supplierId) && !suppliers.has(text(draft.supplierId)))
      throw failure('validation-failed', '分供方不存在或来源不可用', { supplierId: ['分供方不存在'] })
    try {
      validateMaterialDetails(draft.lineItems ?? [], draft.deductions ?? [], {
        formal: action !== 'draft',
        supplement: draft.isSupplement === true,
        originalLineIds: new Set([...(parent?.draft.lineItems ?? []), ...(parent?.history.flatMap(version => version.draft.lineItems ?? []) ?? []), ...(parent?.migrationEvidence?.sourceGraph?.lines ?? [])].flatMap(row => typeof row.id === 'string' ? [row.id] : [])),
      })
    }
    catch (cause) {
      throw failure('validation-failed', cause instanceof Error ? cause.message : '采购明细无效')
    }
    if (action === 'submit') {
      const total = materialContractTotal(draft.lineItems ?? [], draft.deductions ?? [], draft.isSupplement === true)
      if (total == null || Math.abs(total - (number(draft.amount) ?? 0)) > 0.005)
        throw failure('validation-failed', '材采明细含税汇总与合同头金额不一致', { amount: ['应等于采购明细及独立减项合计'] })
    }
  }

  function assertEnvelope(request: MaterialContractCommandRequestDTO, session: BusinessSession) {
    if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId)
      throw failure('forbidden', '请求身份与当前会话不匹配')
    if (request.requiredCapability !== MATERIAL_CONTRACT_WRITE_CAPABILITY
      || !session.capabilities.includes(MATERIAL_CONTRACT_WRITE_CAPABILITY)) {
      throw failure('forbidden', '无材料采购合同写入权限')
    }
    if (!text(request.commandId))
      throw failure('validation-failed', 'commandId 必填')
  }

  function toRow(stored: StoredMaterialContract, sessionId?: string | null): MaterialContractDetailSource {
    const draft = stored.draft
    const { projects, suppliers } = referenceMaps(sessionId)
    const projectId = text(draft.projectId)
    const supplierId = text(draft.supplierId)
    const hasProject = Boolean(projectId && projects.has(projectId))
    const hasSupplier = Boolean(supplierId && suppliers.has(supplierId))
    return {
      dataOrigin: 'real',
      id: stored.id,
      no: text(draft.no),
      name: text(draft.name),
      kind: '材采',
      projectId: projectId || null,
      projectName: hasProject ? projects.get(projectId) ?? '' : '',
      projectReferenceState: !projectId || hasProject ? 'resolved' : 'missing-target',
      supplierId: supplierId || null,
      supplierName: hasSupplier ? suppliers.get(supplierId) ?? '' : '',
      supplierReferenceState: !supplierId || hasSupplier ? 'resolved' : 'missing-target',
      amount: number(draft.amount),
      supplementAmount: [...stateFor(sessionId).contracts.values()]
        .filter(row => visible(row) && row.draft.isSupplement && row.draft.originalContractId === stored.id && !['draft', '草稿', '失效', '作废'].includes(text(row.draft.status)))
        .reduce<number | null>((sum, row) => sum == null || number(row.draft.amount) == null ? null : sum + Number(row.draft.amount), 0),
      settledAmount: 0,
      invoicedAmount: 0,
      paidAmount: 0,
      content: text(draft.content),
      ourSignatorySnapshot: draft.ourSignatorySnapshot ? structuredClone(draft.ourSignatorySnapshot) : null,
      legacyPartyA: draft.legacyPartyA ?? null,
      invoiceType: text(draft.invoiceType),
      contactName: text(draft.contactName),
      contactPhone: text(draft.contactPhone),
      taxRate: number(draft.taxRate),
      signDate: text(draft.signDate) || null,
      mainTerms: text(draft.mainTerms),
      paymentTerms: text(draft.paymentTerms),
      brandQualityTerms: text(draft.brandQualityTerms),
      scheduleTerms: text(draft.scheduleTerms),
      warrantyTerms: text(draft.warrantyTerms),
      specialTerms: text(draft.specialTerms),
      retentionRatio: number(draft.retentionRatio),
      retentionAmount: number(draft.retentionAmount),
      retentionDays: number(draft.retentionDays),
      invoiceName: text(draft.invoiceName),
      invoiceTaxNo: text(draft.invoiceTaxNo),
      invoiceAddressPhone: text(draft.invoiceAddressPhone),
      invoiceBank: text(draft.invoiceBank),
      invoiceBankAccount: text(draft.invoiceBankAccount),
      status: text(draft.status),
      note: typeof draft.note === 'string' ? draft.note : '',
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    }
  }

  function lineRows(state: SessionState): MaterialContractLineSource[] {
    return [...state.contracts.values()].filter(visible).flatMap(stored => (stored.draft.lineItems ?? []).map(row => ({
      dataOrigin: 'real' as const,
      id: text(row.id),
      contractId: stored.id,
      materialName: text(row.materialName),
      spec: text(row.spec),
      materialGrade: text(row.materialGrade),
      brand: text(row.brand),
      unit: text(row.unit),
      qty: number(row.qty),
      taxInclusiveUnitPrice: number(row.taxInclusiveUnitPrice),
      applicableTaxRate: number(row.applicableTaxRate),
      plannedArrivalDate: text(row.plannedArrivalDate) || null,
      note: typeof row.note === 'string' ? row.note : '',
      sortOrder: number(row.sortOrder) ?? 0,
      originalLineId: text(row.originalLineId) || null,
      changeAmount: number(row.changeAmount),
      changeBasis: text(row.changeBasis),
      source: row.source ? structuredClone(row.source) : null,
    })))
  }

  function cloneSessionState(state: SessionState): SessionState {
    return {
      commands: new Map([...state.commands].map(([id, result]) => [id, structuredClone(result)])),
      commandFingerprints: new Map(state.commandFingerprints),
      sealedCommands: new Set(state.sealedCommands),
      requestEvidence: new Map([...state.requestEvidence].map(([key, request]) => [key, structuredClone(request)])),
      contracts: new Map([...state.contracts].map(([id, contract]) => [id, structuredClone(contract)])),
      migratedProjects: structuredClone(state.migratedProjects),
      migratedSuppliers: structuredClone(state.migratedSuppliers),
      originals: structuredClone(state.originals),
      sourceVersion: state.sourceVersion,
    }
  }

  function visible(row: StoredMaterialContract): boolean {
    return !row.migrationRetired && !row.migrationEvidence?.deletedAt
  }

  const api = {
    exportState(sessionId?: string | null): MaterialContractOwnerSnapshot {
      const state = stateFor(sessionId)
      return structuredClone({ schemaVersion: 1, sourceVersion: state.sourceVersion, contracts: [...state.contracts.values()], commands: [...state.commands], commandFingerprints: [...state.commandFingerprints], sealedCommands: [...state.sealedCommands], requestEvidence: [...state.requestEvidence] })
    },
    importState(snapshot: MaterialContractOwnerSnapshot, sessionId?: string | null) {
      if (snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.sourceVersion) || snapshot.sourceVersion < 0)
        throw failure('validation-failed', '材采持久 owner 版本无效')
      const contracts = new Map<string, StoredMaterialContract>()
      const ownedIdentities = new Map<string, string>()
      const assertDetails = (id: string, draft: ProjectContractFormDraft, files: ContractFormAttachment[]) => {
        decodeMaterialContractDraft(draft)
        for (const [kind, rows] of [['line', draft.lineItems ?? []], ['deduction', draft.deductions ?? []], ['file', files]] as const) {
          const ids = new Set<string>()
          for (const row of rows) {
            if (!row.id || ids.has(row.id) || (ownedIdentities.has(`${kind}:${row.id}`) && ownedIdentities.get(`${kind}:${row.id}`) !== id))
              throw failure('validation-failed', '材采明细、减项或原件的稳定身份重复或跨归属')
            ids.add(row.id)
            ownedIdentities.set(`${kind}:${row.id}`, id)
          }
        }
        for (const file of files) {
          decodeMaterialContractAttachment(file, id)
          if (file.ownerType !== (draft.isSupplement ? 'contract_supplement' : 'contract'))
            throw failure('validation-failed', '材采原件类型与合同/协议身份不一致')
        }
      }
      for (const row of snapshot.contracts) {
        if (!row.id || contracts.has(row.id) || row.draft.id !== row.id || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt)))
          throw failure('validation-failed', '材采持久合同身份、版本或日期无效')
        assertDetails(row.id, row.draft, row.attachments)
        const versions = new Set<number>()
        for (const history of row.history) {
          if (history.draft.id !== row.id || !Number.isSafeInteger(history.version) || history.version < 1 || history.version >= row.version || versions.has(history.version) || !Number.isFinite(Date.parse(history.updatedAt))
            || Boolean(history.draft.isSupplement) !== Boolean(row.draft.isSupplement) || history.draft.originalContractId !== row.draft.originalContractId) {
            throw failure('validation-failed', '材采历史版本身份或顺序无效')
          }
          versions.add(history.version)
          assertDetails(row.id, history.draft, history.attachments)
          if (history.attachments.some(file => !row.attachments.some(current => current.id === file.id && current.sha256 === file.sha256 && current.fileName === file.fileName && current.fileSize === file.fileSize)))
            throw failure('validation-failed', '材采历史原件身份或正文证据被移除')
        }
        contracts.set(row.id, structuredClone(row))
      }
      for (const row of contracts.values()) {
        if (row.draft.isSupplement) {
          const parent = contracts.get(text(row.draft.originalContractId))
          if (!parent || parent.draft.isSupplement || row.draft.projectId !== parent.draft.projectId || row.draft.supplierId !== parent.draft.supplierId
            || row.history.some(prior => prior.draft.projectId !== parent.draft.projectId || prior.draft.supplierId !== parent.draft.supplierId)) {
            throw failure('validation-failed', '材采持久协议父子关系无效')
          }
          const frozenIds = new Set<string>()
          for (const frozen of row.originalLineSnapshots ?? []) {
            if (!frozen.originalLineId || frozenIds.has(frozen.originalLineId) || frozen.line.id !== frozen.originalLineId)
              throw failure('validation-failed', '材采协议原行冻结身份损坏')
            frozenIds.add(frozen.originalLineId)
            const version = frozen.parentVersion === parent.version ? parent : parent.history.find(prior => prior.version === frozen.parentVersion)
            if (frozen.parentVersion === null) {
              const originals = row.migrationEvidence?.sourceGraph?.lines.filter(line => line.original_line_id === frozen.originalLineId && typeof line.original_line_snapshot === 'string') ?? []
              const proven = originals.some((line) => {
                try {
                  const raw = JSON.parse(String(line.original_line_snapshot)) as Record<string, unknown>
                  return raw.id === frozen.originalLineId && raw.contract_id === parent.migrationEvidence?.sourceGraph?.head.id
                    && new Date(String(raw.updated_at)).toISOString() === frozen.sourceUpdatedAt
                    && String(raw.updated_at) === line.original_source_updated_at
                    && isDeepStrictEqual(materialMigratedLine(raw, (message) => { throw failure('validation-failed', message) }), frozen.line)
                }
                catch { return false }
              })
              if (!proven)
                throw failure('validation-failed', '旧协议冻结依据缺少真实来源证据')
            }
            else if (!Number.isSafeInteger(frozen.parentVersion) || frozen.parentVersion < 1 || !version?.draft.lineItems?.some(line => isDeepStrictEqual(line, frozen.line))) {
              throw failure('validation-failed', '材采协议原行冻结内容与原合同历史不一致')
            }
          }
        }
      }
      const commands = new Map(snapshot.commands)
      const commandFingerprints = new Map(snapshot.commandFingerprints)
      const requestEvidence = new Map(snapshot.requestEvidence)
      if (commands.size !== snapshot.commands.length || commandFingerprints.size !== snapshot.commandFingerprints.length || requestEvidence.size !== snapshot.requestEvidence.length || new Set(snapshot.sealedCommands).size !== snapshot.sealedCommands.length)
        throw failure('validation-failed', '材采命令记录身份重复')
      const parseKey = (key: string) => {
        let parts: unknown

        try {
          parts = JSON.parse(key)
        }
        catch { throw failure('validation-failed', '材采原命令作用域编码损坏') }
        if (!Array.isArray(parts) || parts.length !== 4 || parts.some(part => typeof part !== 'string' || !part) || parts[2] !== 'material-contract')
          throw failure('validation-failed', '材采原命令作用域损坏')
        return parts as [string, string, string, string]
      }
      if (requestEvidence.size !== commandFingerprints.size)
        throw failure('validation-failed', '材采原提交与指纹集合不一致')
      for (const [key, request] of requestEvidence) {
        const [workspaceId, actorId, , commandId] = parseKey(key)
        if (request.workspaceId !== workspaceId || request.actorId !== actorId || request.commandId !== commandId || request.requiredCapability !== MATERIAL_CONTRACT_WRITE_CAPABILITY
          || commandJournalKey(commandId, { workspaceId, actorId, capabilities: [] }, 'material-contract') !== key || commandFingerprint(request) !== commandFingerprints.get(key)) {
          throw failure('validation-failed', '材采原提交身份或完整指纹不一致')
        }
        parseMaterialContractCommandRequest(request, request.id ? { kind: 'update', routeId: request.id } : { kind: 'create' })
      }
      for (const key of snapshot.sealedCommands)
        parseKey(key)
      for (const [key, result] of commands) {
        const request = requestEvidence.get(key)
        if (!contracts.has(result.id) || !request || request.commandId !== result.commandId || commandFingerprint(request) !== commandFingerprints.get(key) || snapshot.sealedCommands.includes(key))
          throw failure('validation-failed', '材采持久回执、请求证据或封存记录不一致')
        const record = contracts.get(result.id)!
        const version = Number(result.version) === record.version ? record : record.history.find(row => row.version === Number(result.version))
        if (!version || result.updatedAt !== version.updatedAt || (request.id && request.id !== result.id)
          || !isDeepStrictEqual(result.attachmentIds, version.attachments.filter(file => file.deletedAt === null).map(file => file.id))
          || (result.lineIds && !isDeepStrictEqual(result.lineIds, (version.draft.lineItems ?? []).map(line => line.id)))
          || (result.deductionIds && !isDeepStrictEqual(result.deductionIds, (version.draft.deductions ?? []).map(row => row.id)))) {
          throw failure('validation-failed', '材采原回执与已保存版本或稳定明细身份不一致')
        }
      }
      const originals = new Map<string, { bytes: Uint8Array, sha256: string }>()
      const allocatedIds = new Set<string>()
      for (const row of contracts.values()) {
        if (row.migrationEvidence?.sourceGraph) {
          const files = contractMigratedAttachments(row.migrationEvidence.sourceGraph.attachments, { ownerId: row.id, legacyOwnerId: row.migrationEvidence.sourceGraph.head.id as string, ownerType: row.draft.isSupplement ? 'contract_supplement' : 'contract', allocatedIds, originals, fail: (message) => {
            throw failure('validation-failed', message)
          } })
          if (files.some(file => !row.attachments.some(current => current.id === file.id && current.sha256 === file.sha256)))
            throw failure('validation-failed', '材采迁移原件证据被移除或改写')
        }
      }
      states.set(keyFor(sessionId), { contracts, originals, migratedProjects: new Map(), migratedSuppliers: new Map(), commands: structuredClone(commands), commandFingerprints: structuredClone(commandFingerprints), sealedCommands: new Set(snapshot.sealedCommands), requestEvidence: structuredClone(requestEvidence), sourceVersion: snapshot.sourceVersion })
    },
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    formContext(sessionId?: string | null) {
      const state = stateFor(sessionId)
      return {
        projects: [...referenceMaps(sessionId).projects].map(([id, name]) => ({ id, name })),
        suppliers: [...new Map([...state.migratedSuppliers.values(), ...resolveSuppliers(sessionId)].map(row => [row.id, row])).values()].map(row => ({ ...row })),
        originalContracts: [...state.contracts.values()].filter(row => visible(row) && !row.draft.isSupplement).map(row => ({
          id: row.id,
          no: text(row.draft.no),
          label: text(row.draft.no) ? `${text(row.draft.no)} · ${text(row.draft.name)}` : text(row.draft.name),
          projectId: row.draft.projectId ?? null,
          supplierId: row.draft.supplierId ?? null,
          lineItems: structuredClone(row.draft.lineItems ?? []),
          ourSignatorySnapshot: row.draft.ourSignatorySnapshot ? structuredClone(row.draft.ourSignatorySnapshot) : null,
        })),
      }
    },
    rows(sessionId?: string | null) {
      return [...stateFor(sessionId).contracts.values()].filter(row => visible(row) && !row.draft.isSupplement).map(row => toRow(row, sessionId))
    },
    /** 预算对比须保留原金额空值；调用方先经本领域 read 授权。 */
    budgetRows(sessionId?: string | null) {
      return [...stateFor(sessionId).contracts.values()].filter(row => visible(row) && !row.draft.isSupplement).map(row => ({ ...toRow(row, sessionId), amount: row.draft.amount ?? null }))
    },
    facts(sessionId?: string | null): MaterialContractFactSources {
      const state = stateFor(sessionId)
      const files = [...state.contracts.values()].filter(visible).flatMap(stored => stored.attachments
        .filter(file => file.deletedAt === null)
        .map(file => ({
          dataOrigin: 'real' as const,
          id: file.id,
          contractId: stored.id,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          category: file.category,
          uploadedAt: file.uploadedAt,
          originalAvailable: Boolean(file.sha256),
        })))
      return {
        lineItems: lineRows(state),
        deductions: [...state.contracts.values()].filter(visible).flatMap(stored => (stored.draft.deductions ?? []).map(row => ({
          dataOrigin: 'real' as const,
          id: text(row.id),
          ownerId: stored.id,
          name: text(row.name),
          amount: number(row.amount),
          basis: text(row.basis),
          sortOrder: number(row.sortOrder) ?? 0,
        }))),
        supplements: [...state.contracts.values()].filter(stored => visible(stored) && stored.draft.isSupplement).map(stored => ({
          ourSignatorySnapshot: stored.draft.ourSignatorySnapshot ? structuredClone(stored.draft.ourSignatorySnapshot) : null,
          dataOrigin: 'real' as const,
          id: stored.id,
          contractId: text(stored.draft.originalContractId),
          no: text(stored.draft.no),
          name: text(stored.draft.name),
          content: text(stored.draft.content),
          amount: number(stored.draft.amount),
          signDate: text(stored.draft.signDate) || null,
          status: text(stored.draft.status),
          originalLineSnapshots: structuredClone(stored.originalLineSnapshots ?? []),
        })),
        materialRequisitions: [],
        materialArrivals: [],
        invoices: [],
        paymentApplications: [],
        paymentRecords: [],
        paymentAllocations: [],
        settlements: [],
        penalties: [],
        files,
      }
    },
    sourceVersion(sessionId?: string | null) {
      return `material-contract-command-${stateFor(sessionId).sourceVersion}`
    },
    importExisting(records: readonly MaterialContractMigrationRecord[], sessionId?: string | null) {
      const state = stateFor(sessionId)
      const snapshot = cloneSessionState(state)
      const imported: string[] = []
      try {
        for (const record of [...records].sort((a, b) => Number(Boolean(a.draft.isSupplement)) - Number(Boolean(b.draft.isSupplement)))) {
          const id = text(record.id)
          if (!id || (record.draft.id && text(record.draft.id) !== id))
            throw failure('validation-failed', '迁移合同 ID 无效或不一致')
          const lineIds = (record.draft.lineItems ?? []).map(row => text(row.id))
          if (lineIds.some(lineId => !lineId) || new Set(lineIds).size !== lineIds.length)
            throw failure('validation-failed', '迁移采购明细必须携带唯一稳定 ID')
          const deductionIds = (record.draft.deductions ?? []).map(row => text(row.id))
          if (deductionIds.some(id => !id) || new Set(deductionIds).size !== deductionIds.length)
            throw failure('validation-failed', '迁移减项必须携带唯一稳定 ID')
          if (record.sourceGraph)
            decodeMaterialContractDraft(record.draft)
          else
            validate(record.draft, ['draft', '草稿'].includes(text(record.draft.status)) ? 'draft' : 'save', sessionId)
          const current = state.contracts.get(id)
          if (current) {
            if (current.migrationEvidence && commandFingerprint(current.migrationEvidence) === commandFingerprint(record))
              continue
            throw failure('conflict', '迁移合同 ID 已存在且内容不一致')
          }
          state.contracts.set(id, {
            id,
            draft: cleanDraft(record.draft, id, null, true),
            attachments: structuredClone(record.attachments ?? []),
            version: record.version ?? 1,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            history: structuredClone(record.history ?? []),
            migrationEvidence: structuredClone(record),
            ...(record.originalLineSnapshots ? { originalLineSnapshots: structuredClone(record.originalLineSnapshots) } : {}),
          })
          state.sourceVersion += 1
          imported.push(id)
        }
        return imported
      }
      catch (cause) {
        states.set(keyFor(sessionId), snapshot)
        throw cause
      }
    },
    prepareMigrationSnapshot,
    synchronizeMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      prepareMigrationSnapshot(snapshot, sessionId)()
    },
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[], sessionId?: string | null) {
      const state = stateFor(sessionId)
      const deleted = new Set(removed.map(row => `${row.entityType}:${row.id}`))
      for (const row of state.contracts.values()) {
        if (row.migrationRetired)
          continue
        const removingSelf = deleted.has(`${row.draft.isSupplement ? 'contract_supplements' : 'material_contracts'}:${row.id}`)
        if (removingSelf) {
          if (row.version !== 1 || row.history.length || [...state.commands.values()].some(receipt => receipt.id === row.id))
            throw failure('conflict', '迁入材采已有后来写入或原回执，不能回滚移除')
          continue
        }
        const drafts = [row.draft, ...row.history.map(history => history.draft)]
        if (drafts.some(draft => deleted.has(`projects:${draft.projectId}`) || deleted.has(`suppliers:${draft.supplierId}`) || (draft.isSupplement && deleted.has(`material_contracts:${draft.originalContractId}`))))
          throw failure('conflict', '材采当前、软删或历史事实仍引用待移除目标，不能回滚制造孤儿')
      }
    },
    applyMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const state = stateFor(sessionId)
      const entities = snapshot.authority === 'central' && snapshot.activeBatchId ? snapshot.entities : []
      const heads = entities.filter(row => row.entityType === 'material_contracts')
      const headIds = new Set(heads.map(row => row.id))
      const owned = [...heads, ...entities.filter(row => row.entityType === 'contract_supplements' && headIds.has(row.references.contractId ?? ''))]
      const ownedIds = new Set(owned.map(row => row.id))
      for (const row of state.contracts.values()) {
        if (row.migrationEvidence?.migrationBatchId && (!ownedIds.has(row.id) || row.migrationEvidence.migrationBatchId !== snapshot.activeBatchId)) {
          if (row.version !== 1 || row.history.length || [...state.commands.values()].some(receipt => receipt.id === row.id))
            throw failure('conflict', '迁入材采已有后来修改、原件写入或回执，不能回滚移除')
          if (!row.migrationRetired) {
            row.migrationRetired = true
            state.sourceVersion++
          }
        }
      }
      state.migratedProjects = new Map(entities.filter(row => row.entityType === 'projects' && row.deletedAt === null).map(row => [row.id, { id: row.id, name: row.name }]))
      state.migratedSuppliers = new Map(entities.filter(row => row.entityType === 'suppliers' && row.deletedAt === null).map(row => [row.id, { id: row.id, name: row.name }]))
      const allocatedIds = new Set<string>([...state.contracts.values()].flatMap(row => [...(row.draft.lineItems ?? []).map(line => `line:${line.id}`), ...(row.draft.deductions ?? []).map(deduction => `deduction:${deduction.id}`), ...row.attachments.map(file => file.id)]))
      for (const entity of owned) {
        const current = state.contracts.get(entity.id)
        if (current) {
          if (current.migrationEvidence?.migrationBatchId !== entity.batchId || commandFingerprint(current.migrationEvidence.sourceGraph) !== commandFingerprint(JSON.parse(String(entity.attributes.materialGraphJson))))
            throw failure('conflict', '迁入材采稳定身份与既有中央记录或原证据冲突')
          if (current.migrationRetired) {
            current.migrationRetired = false
            state.sourceVersion++
          }
          continue
        }
        const parent = entity.entityType === 'contract_supplements' ? heads.find(row => row.id === entity.references.contractId) : undefined

        const record = migratedMaterialContract(entity, { parent, parentGraph: parent ? JSON.parse(String(parent.attributes.materialGraphJson)) : undefined, allocatedIds, originals: state.originals, fail: (message) => {
          throw failure('validation-failed', message)
        } })
        api.importExisting([record], sessionId)
      }
    },
    form(id: string, session: BusinessSession, sessionId?: string | null): MaterialContractFormReadDTO {
      if (!session.capabilities.includes(MATERIAL_CONTRACT_WRITE_CAPABILITY))
        throw failure('forbidden', '无材料采购合同写入权限')
      const stored = stateFor(sessionId).contracts.get(id)
      if (!stored || !visible(stored))
        throw failure('not-found', '正式材料采购合同不存在')
      return {
        draft: structuredClone(stored.draft),
        attachments: structuredClone(stored.attachments),
        version: String(stored.version),
        updatedAt: stored.updatedAt,
      }
    },
    history(id: string, session: BusinessSession, sessionId?: string | null) {
      if (!session.capabilities.includes(MATERIAL_CONTRACT_WRITE_CAPABILITY))
        throw failure('forbidden', '无材料采购合同写入权限')
      const stored = stateFor(sessionId).contracts.get(id)
      if (!stored)
        throw failure('not-found', '正式材料采购合同不存在')
      return structuredClone(stored.history)
    },
    file(id: string, fileId: string, session: BusinessSession, sessionId?: string | null) {
      if (!session.capabilities.includes('material-contract:read'))
        throw failure('forbidden', '无材料采购合同读取权限')
      const state = stateFor(sessionId)
      const stored = state.contracts.get(id)
      const file = stored?.attachments.find(row => row.id === fileId && row.deletedAt === null)
      if (!stored || !visible(stored) || !file || file.ownerId !== id || file.ownerType !== (stored.draft.isSupplement ? 'contract_supplement' : 'contract'))
        throw failure('not-found', '原件不存在或不属于此合同')
      if (!file.sha256)
        throw failure('not-found', '历史附件仅有元数据，未保存可读取的原件正文')
      const migrated = state.originals.get(file.id)
      if (migrated) {
        if (migrated.bytes.length !== file.fileSize || materialOriginalDigest(migrated.bytes) !== file.sha256 || migrated.sha256 !== file.sha256)
          throw failure('conflict', '迁入材采原件正文或摘要损坏')
        return { bytes: structuredClone(migrated.bytes), sha256: migrated.sha256, fileName: file.fileName, mimeType: file.mimeType }
      }
      for (const [key, result] of state.commands) {
        if (result.id !== id)
          continue
        const request = state.requestEvidence.get(key)
        const version = Number(result.version)
        const current = version === stored.version ? stored : stored.history.find(row => row.version === version)
        const previous = stored.history.find(row => row.version === version - 1)
        const created = current?.attachments.filter(row => !previous?.attachments.some(old => old.id === row.id)) ?? []
        const index = created.findIndex(row => row.id === fileId)
        const draft = index < 0 ? null : request?.attachments.add?.[index]
        if (!draft)
          continue
        const bytes = materialOriginalBytes(draft, true)!
        if (bytes.length !== file.fileSize || materialOriginalDigest(bytes) !== file.sha256)
          throw failure('validation-failed', '原件正文与不可变附件证据不一致')
        return { fileName: file.fileName, mimeType: file.mimeType, sha256: file.sha256, bytes }
      }
      throw failure('not-found', '原件的原提交证据缺失，请核对受控恢复来源')
    },
    resolve(commandId: string, session: BusinessSession, sessionId?: string | null): MaterialContractCommandResolutionDTO {
      assertEnvelope({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: MATERIAL_CONTRACT_WRITE_CAPABILITY, commandId } as MaterialContractCommandRequestDTO, session)
      return resolveJournalCommand(stateFor(sessionId), commandId, session, 'material-contract')
    },
    async execute(
      request: MaterialContractCommandRequestDTO,
      session: BusinessSession,
      sessionId?: string | null,
    ): Promise<MaterialContractCommandResultDTO> {
      assertEnvelope(request, session)
      const state = stateFor(sessionId)
      const replay = commandReplay(state, request, session, 'material-contract', message => failure('validation-failed', message))
      if (!state.requestEvidence.has(replay.key))
        state.requestEvidence.set(replay.key, structuredClone(request))
      if (replay.previous)
        return replay.previous
      const existing = request.id ? state.contracts.get(request.id) ?? null : null
      if (request.id && (!existing || !visible(existing)))
        throw failure('not-found', '正式材料采购合同不存在')
      if (!request.id && request.baseVersion !== null)
        throw failure('validation-failed', '新建合同不能带 baseVersion')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '合同已被其他操作更新，请先处理最新版本')
      if (existing && Boolean(request.draft.isSupplement) !== Boolean(existing.draft.isSupplement))
        throw failure('validation-failed', '主合同与补充协议身份不能互换')
      if (existing?.draft.isSupplement && request.draft.originalContractId !== existing.draft.originalContractId)
        throw failure('validation-failed', '补充协议不能改归其他原合同')
      const parent = request.draft.isSupplement && request.draft.originalContractId ? state.contracts.get(request.draft.originalContractId) : null
      let candidate = parent ? { ...request.draft, projectId: parent.draft.projectId, supplierId: parent.draft.supplierId } : request.draft
      await options.validateDependencies?.(request, candidate, existing)
      validate(candidate, request.action, sessionId)
      if (parent) {
        const frozen = existing ? existing.draft.ourSignatorySnapshot ?? null : parent.draft.ourSignatorySnapshot ?? null
        if (!existing && options.resolveSignatory && request.action !== 'draft' && !frozen)
          throw failure('validation-failed', '原合同尚未核实我方签约主体，请先核实原合同')
        if (candidate.ourSignatoryId && candidate.ourSignatoryId !== frozen?.id)
          throw failure('validation-failed', '补充协议不能更换我方签约主体')
        candidate = { ...candidate, ourSignatoryId: frozen?.id ?? null, ourSignatoryVersion: frozen?.version ?? null, ourSignatorySnapshot: frozen }
      }
      else if (options.resolveSignatory) {
        const snapshot = await options.resolveSignatory(candidate, existing, request.action !== 'draft', session, sessionId)
        candidate = { ...candidate, ourSignatoryId: snapshot?.id ?? null, ourSignatoryVersion: snapshot?.version ?? null, ourSignatorySnapshot: snapshot }
      }
      assertCommandUnsealed(state, replay.key, message => failure('validation-failed', message))
      const duplicateNumber = !candidate.isSupplement && options.numberConflict ? await options.numberConflict(text(candidate.no), existing?.id ?? null) : false
      if (duplicateNumber && request.action !== 'draft')
        throw failure('validation-failed', '已填写的合同编号与其他正式主合同重复', { no: ['请核对原编号'] })
      assertCommandUnsealed(state, replay.key, message => failure('validation-failed', message))
      const appliedDuringRead = state.commands.get(replay.key)
      if (appliedDuringRead)
        return structuredClone(appliedDuringRead)
      if (existing && state.contracts.get(existing.id)?.version !== existing.version)
        throw failure('conflict', '合同在核对签约主体期间已更新，请保留原输入并核对版本')
      const timestamp = now()
      const id = existing?.id ?? createId()
      const draft = cleanDraft(candidate, id, existing)
      draft.status = request.action === 'draft' ? '草稿' : text(candidate.status) === '草稿' || !text(candidate.status) ? '审批中' : text(candidate.status)
      const removed = new Set(request.attachments.removeIds ?? [])
      const restored = new Set(request.attachments.restoreIds ?? [])
      if ([...removed, ...restored].some(id => !existing?.attachments.some(file => file.id === id)))
        throw failure('validation-failed', '附件不存在或不属于当前合同或协议')
      const attachments = (existing?.attachments ?? []).map(file => ({
        ...file,
        deletedAt: removed.has(file.id) ? timestamp : restored.has(file.id) ? null : file.deletedAt,
      }))
      for (const file of request.attachments.add ?? []) {
        const bytes = materialOriginalBytes(file)
        const attachmentId = createAttachmentId()
        attachments.push({
          id: attachmentId,
          ownerType: draft.isSupplement ? 'contract_supplement' : 'contract',
          ownerId: id,
          fileName: text(file.fileName),
          filePath: text(file.filePath),
          fileSize: number(file.fileSize) ?? 0,
          mimeType: text(file.mimeType),
          category: text(file.category),
          uploader: text(file.uploader),
          uploadedAt: timestamp,
          deletedAt: null,
          ...(bytes ? { sha256: materialOriginalDigest(bytes) } : {}),
        })
      }
      try {
        validateMaterialSourceOriginals(draft.lineItems ?? [], existing?.draft.lineItems ?? [], attachments.flatMap(file => file.sha256 ? [{ fileName: file.fileName, sha256: file.sha256 }] : []))
      }
      catch (cause) { throw failure('validation-failed', cause instanceof Error ? cause.message : '材采来源原件无法核验') }
      const stored: StoredMaterialContract = {
        id,
        draft,
        attachments,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        history: [...(existing?.history ?? []), ...(existing ? [{ draft: structuredClone(existing.draft), attachments: structuredClone(existing.attachments), version: existing.version, updatedAt: existing.updatedAt, actorId: session.actorId, commandId: request.commandId, action: request.action }] : [])],
        ...(existing?.migrationEvidence ? { migrationEvidence: existing.migrationEvidence } : {}),
        ...(parent
          ? { originalLineSnapshots: [...new Map([...(existing?.originalLineSnapshots ?? []), ...(draft.lineItems ?? []).flatMap((line) => {
              if (!line.originalLineId)
                return []
              const frozen = existing?.originalLineSnapshots?.find(row => row.originalLineId === line.originalLineId)
              if (frozen)
                return [structuredClone(frozen)]
              if (existing?.migrationEvidence && existing.draft.lineItems?.some(prior => prior.originalLineId === line.originalLineId))
                return []
              const currentOriginal = parent.draft.lineItems?.find(row => row.id === line.originalLineId)
              const historical = parent.history.find(version => version.draft.lineItems?.some(row => row.id === line.originalLineId))
              const original = currentOriginal ?? historical?.draft.lineItems?.find(row => row.id === line.originalLineId)
              return original ? [{ originalLineId: line.originalLineId, parentVersion: currentOriginal ? parent.version : historical!.version, line: structuredClone(original) }] : []
            })].map(row => [row.originalLineId, row])).values()] }
          : {}),
      }
      state.contracts.set(id, stored)
      state.sourceVersion += 1
      const result: MaterialContractCommandResultDTO = {
        id,
        commandId: request.commandId,
        version: String(stored.version),
        updatedAt: timestamp,
        attachmentIds: attachments.filter(file => file.deletedAt === null).map(file => file.id),
        lineIds: (draft.lineItems ?? []).map(row => row.id!),
        deductionIds: (draft.deductions ?? []).map(row => row.id!),
        ...(duplicateNumber ? { warnings: ['草稿编号与其他正式主合同重复，正式提交前请核对。'] } : {}),
      }
      state.commands.set(replay.key, result)
      return structuredClone(result)
    },
  }
  function prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
    const key = keyFor(sessionId)
    const before = stateFor(sessionId)
    states.set(key, cloneSessionState(before))
    let candidate: SessionState
    try {
      api.applyMigrationSnapshot(snapshot, sessionId)
      candidate = stateFor(sessionId)
    }
    finally { states.set(key, before) }
    return () => states.set(key, candidate)
  }
  return api
}

export const MATERIAL_CONTRACT_EXISTING_ID = 'contract-existing-318'

export const MATERIAL_CONTRACT_EXISTING_RECORD: MaterialContractMigrationRecord = {
  id: MATERIAL_CONTRACT_EXISTING_ID,
  draft: {
    id: MATERIAL_CONTRACT_EXISTING_ID,
    no: 'CG-EXISTING-318',
    name: '既有中央材料采购合同',
    projectId: 'project-real-318',
    supplierId: 'supplier-real-318',
    content: '既有瓷砖采购合同受控迁入中央',
    signDate: '2026-01-08',
    amount: 9600,
    status: '履约中',
    lineItems: [{
      id: 'line-existing-318',
      materialName: '既有瓷砖',
      unit: '㎡',
      qty: 400,
      taxInclusiveUnitPrice: 24,
    }],
  },
  attachments: [],
  version: 1,
  createdAt: '2026-01-08T00:00:00.000Z',
  updatedAt: '2026-01-08T00:00:00.000Z',
}

export const materialContractCommandTestInstance = createMaterialContractCommandTestInstance({
  resolveSignatory: (draft, existing, required, _session, sessionId) => developmentOurSignatoryOwner(sessionId).withTransaction(async (tx) => {
    try {
      return await resolveContractSignatory(tx, { id: draft.ourSignatoryId, version: draft.ourSignatoryVersion, prior: existing?.draft.ourSignatorySnapshot, required })
    }
    catch (cause) {
      if (cause instanceof OurSignatoryRepositoryProblem)
        throw new MaterialContractRepositoryProblem(cause.problem)
      throw cause
    }
  }),
  resolveProjects: sessionId => projectCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name })),
  resolveSuppliers: sessionId => supplierCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name, contact: row.contact, contactPhone: row.contactPhone })),
})
