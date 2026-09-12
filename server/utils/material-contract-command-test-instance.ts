import type {
  ContractFormAttachment,
  ProjectContractFormDraft,
} from '../../app/lib/contract/forms'
import type {
  MaterialContractCommandRequestDTO,
  MaterialContractCommandResultDTO,
  MaterialContractFormReadDTO,
} from '../../app/lib/material-contract/command-contract'
import type {
  MaterialContractDetailSource,
  MaterialContractFactSources,
  MaterialContractLineSource,
} from '../../app/lib/material-contract/repository'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '../../app/lib/material-contract/command-contract'
import {
  materialContractProblem,
  MaterialContractRepositoryProblem,
} from '../../app/lib/material-contract/repository'
import { projectCommandTestInstance } from './project-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

interface ReferenceOption {
  id: string
  name: string
}

interface StoredContract {
  id: string
  draft: ProjectContractFormDraft & { id: string }
  attachments: ContractFormAttachment[]
  version: number
  createdAt: string
  updatedAt: string
}

export interface MaterialContractMigrationRecord {
  id: string
  draft: ProjectContractFormDraft
  attachments?: ContractFormAttachment[]
  version?: number
  createdAt: string
  updatedAt: string
}

interface SessionState {
  commands: Map<string, MaterialContractCommandResultDTO>
  contracts: Map<string, StoredContract>
  sourceVersion: number
}

interface Options {
  createId?: () => string
  createLineId?: () => string
  createAttachmentId?: () => string
  now?: () => string
  projects?: readonly ReferenceOption[]
  suppliers?: readonly ReferenceOption[]
  resolveProjects?: (sessionId?: string | null) => readonly ReferenceOption[]
  resolveSuppliers?: (sessionId?: string | null) => readonly ReferenceOption[]
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
  const createAttachmentId = options.createAttachmentId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const legacyProjects = new Map((options.projects ?? []).map(row => [row.id, row.name]))
  const legacySuppliers = new Map((options.suppliers ?? []).map(row => [row.id, row.name]))
  const resolveProjects = options.resolveProjects ?? (() => [...legacyProjects].map(([id, name]) => ({ id, name })))
  const resolveSuppliers = options.resolveSuppliers ?? (() => [...legacySuppliers].map(([id, name]) => ({ id, name })))
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = {
        commands: new Map(),
        contracts: new Map(),
        sourceVersion: 0,
      }
      states.set(key, state)
    }
    return state
  }

  function cleanDraft(
    source: ProjectContractFormDraft,
    id: string,
    existing: StoredContract | null,
    preserveSourceLineIds = false,
  ): ProjectContractFormDraft & { id: string } {
    const existingLineIds = new Set(preserveSourceLineIds
      ? (source.lineItems ?? []).map(row => text(row.id)).filter(Boolean)
      : existing?.draft.lineItems?.map(row => text(row.id)) ?? [])
    return {
      ...source,
      id,
      isSupplement: false,
      originalContractId: null,
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
      status: text(source.status) || '履约中',
      note: typeof source.note === 'string' ? source.note : '',
      lineItems: (source.lineItems ?? []).map((row, index) => ({
        id: existingLineIds.has(text(row.id)) ? text(row.id) : createLineId(),
        materialName: text(row.materialName),
        spec: text(row.spec),
        brand: text(row.brand),
        unit: text(row.unit),
        qty: number(row.qty),
        taxInclusiveUnitPrice: number(row.taxInclusiveUnitPrice),
        plannedArrivalDate: text(row.plannedArrivalDate),
        note: typeof row.note === 'string' ? row.note : '',
        sortOrder: index,
      })),
    }
  }

  function referenceMaps(sessionId?: string | null) {
    return {
      projects: new Map(resolveProjects(sessionId).map(row => [row.id, row.name])),
      suppliers: new Map(resolveSuppliers(sessionId).map(row => [row.id, row.name])),
    }
  }

  function validate(
    draft: ProjectContractFormDraft,
    action: MaterialContractCommandRequestDTO['action'],
    sessionId?: string | null,
  ) {
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
    for (const [index, row] of (draft.lineItems ?? []).entries()) {
      const qty = number(row.qty)
      const price = number(row.taxInclusiveUnitPrice)
      if (action !== 'draft' && (!text(row.materialName) || qty == null || price == null)) {
        throw failure('validation-failed', `采购明细第 ${index + 1} 行不完整`)
      }
      if (qty != null && qty <= 0)
        throw failure('validation-failed', `采购明细第 ${index + 1} 行数量必须大于 0`)
      if (price != null && price < 0)
        throw failure('validation-failed', `采购明细第 ${index + 1} 行含税单价不能为负数`)
    }
    if (action === 'submit') {
      const total = (draft.lineItems ?? []).reduce((sum, row) =>
        sum + (number(row.qty) ?? 0) * (number(row.taxInclusiveUnitPrice) ?? 0), 0)
      if (Math.abs(total - (number(draft.amount) ?? 0)) > 0.005)
        throw failure('validation-failed', '材采明细含税汇总与合同头金额不一致', { amount: ['应等于采购明细含税汇总'] })
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

  function toRow(stored: StoredContract, sessionId?: string | null): MaterialContractDetailSource {
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
      amount: number(draft.amount) ?? 0,
      supplementAmount: 0,
      settledAmount: 0,
      invoicedAmount: 0,
      paidAmount: 0,
      content: text(draft.content),
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
    return [...state.contracts.values()].flatMap(stored => (stored.draft.lineItems ?? []).map(row => ({
      dataOrigin: 'real' as const,
      id: text(row.id),
      contractId: stored.id,
      materialName: text(row.materialName),
      spec: text(row.spec),
      brand: text(row.brand),
      unit: text(row.unit),
      qty: number(row.qty),
      taxInclusiveUnitPrice: number(row.taxInclusiveUnitPrice),
      plannedArrivalDate: text(row.plannedArrivalDate) || null,
      note: typeof row.note === 'string' ? row.note : '',
      sortOrder: number(row.sortOrder) ?? 0,
    })))
  }

  function cloneSessionState(state: SessionState): SessionState {
    return {
      commands: new Map([...state.commands].map(([id, result]) => [id, structuredClone(result)])),
      contracts: new Map([...state.contracts].map(([id, contract]) => [id, structuredClone(contract)])),
      sourceVersion: state.sourceVersion,
    }
  }

  return {
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    formContext(sessionId?: string | null) {
      return {
        projects: resolveProjects(sessionId).map(row => ({ ...row })),
        suppliers: resolveSuppliers(sessionId).map(row => ({ ...row })),
      }
    },
    rows(sessionId?: string | null) {
      return [...stateFor(sessionId).contracts.values()].map(row => toRow(row, sessionId))
    },
    /** 预算对比须保留原金额空值；调用方先经本领域 read 授权。 */
    budgetRows(sessionId?: string | null) {
      return [...stateFor(sessionId).contracts.values()].map(row => ({ ...toRow(row, sessionId), amount: row.draft.amount ?? null }))
    },
    facts(sessionId?: string | null): MaterialContractFactSources {
      const state = stateFor(sessionId)
      const files = [...state.contracts.values()].flatMap(stored => stored.attachments
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
        })))
      return {
        lineItems: lineRows(state),
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
        for (const record of records) {
          const id = text(record.id)
          if (!id || (record.draft.id && text(record.draft.id) !== id))
            throw failure('validation-failed', '迁移合同 ID 无效或不一致')
          const lineIds = (record.draft.lineItems ?? []).map(row => text(row.id))
          if (lineIds.some(lineId => !lineId) || new Set(lineIds).size !== lineIds.length)
            throw failure('validation-failed', '迁移采购明细必须携带唯一稳定 ID')
          validate(record.draft, 'save', sessionId)
          const current = state.contracts.get(id)
          if (current) {
            if (JSON.stringify(current.draft) === JSON.stringify(cleanDraft(record.draft, id, current, true)))
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
    form(id: string, session: BusinessSession, sessionId?: string | null): MaterialContractFormReadDTO {
      if (!session.capabilities.includes(MATERIAL_CONTRACT_WRITE_CAPABILITY))
        throw failure('forbidden', '无材料采购合同写入权限')
      const stored = stateFor(sessionId).contracts.get(id)
      if (!stored)
        throw failure('not-found', '正式材料采购合同不存在')
      return {
        draft: structuredClone(stored.draft),
        attachments: structuredClone(stored.attachments),
        version: String(stored.version),
        updatedAt: stored.updatedAt,
      }
    },
    async execute(
      request: MaterialContractCommandRequestDTO,
      session: BusinessSession,
      sessionId?: string | null,
    ): Promise<MaterialContractCommandResultDTO> {
      assertEnvelope(request, session)
      const state = stateFor(sessionId)
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return structuredClone(duplicate)
      const existing = request.id ? state.contracts.get(request.id) ?? null : null
      if (request.id && !existing)
        throw failure('not-found', '正式材料采购合同不存在')
      if (!request.id && request.baseVersion !== null)
        throw failure('validation-failed', '新建合同不能带 baseVersion')
      if (existing && request.baseVersion !== String(existing.version))
        throw failure('conflict', '合同已被其他操作更新，请先处理最新版本')
      validate(request.draft, request.action, sessionId)
      const timestamp = now()
      const id = existing?.id ?? createId()
      const draft = cleanDraft(request.draft, id, existing)
      const removed = new Set(request.attachments.removeIds ?? [])
      const restored = new Set(request.attachments.restoreIds ?? [])
      const attachments = (existing?.attachments ?? []).map(file => ({
        ...file,
        deletedAt: removed.has(file.id) ? timestamp : restored.has(file.id) ? null : file.deletedAt,
      }))
      for (const file of request.attachments.add ?? []) {
        const attachmentId = createAttachmentId()
        attachments.push({
          id: attachmentId,
          ownerType: 'contract',
          ownerId: id,
          fileName: text(file.fileName),
          filePath: text(file.filePath),
          fileSize: number(file.fileSize) ?? 0,
          mimeType: text(file.mimeType),
          category: text(file.category),
          uploader: text(file.uploader),
          uploadedAt: timestamp,
          deletedAt: null,
        })
      }
      const stored: StoredContract = {
        id,
        draft,
        attachments,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      state.contracts.set(id, stored)
      state.sourceVersion += 1
      const result: MaterialContractCommandResultDTO = {
        id,
        commandId: request.commandId,
        version: String(stored.version),
        updatedAt: timestamp,
        attachmentIds: attachments.filter(file => file.deletedAt === null).map(file => file.id),
      }
      state.commands.set(request.commandId, result)
      return structuredClone(result)
    },
  }
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
  resolveProjects: sessionId => projectCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name })),
  resolveSuppliers: sessionId => supplierCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name })),
})
