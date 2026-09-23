import type {
  ProjectSupplierImportCommandRequestDTO,
  ProjectSupplierImportCommandResultDTO,
} from '../../app/lib/project-supplier/command-contract'
import type {
  ProjectSupplierFileSourceRow,
  ProjectSupplierProjectSourceRow,
  ProjectSupplierRelationSourceRow,
  ProjectSupplierSupplierSourceRow,
} from '../../app/lib/project-supplier/repository'
import type { SupplierListSourceRow, SupplierProjectRelationSourceRow, SupplierProjectSourceRow } from '../../app/lib/supplier/repository'
import type { BusinessSession } from './business-session'
import type { SupplierImportAdoptionTransaction } from './supplier-command-service'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { PROJECT_SUPPLIER_FILE_CATEGORIES, PROJECT_SUPPLIER_WRITE_CAPABILITY } from '../../app/lib/project-supplier/command-contract'
import { projectSupplierProblem, ProjectSupplierRepositoryProblem } from '../../app/lib/project-supplier/repository'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

export interface ProjectSupplierCommandExecutionContext {
  project: { id: string, name: string }
  suppliers: Array<{ id: string, name: string, aliases?: string[] }>
  existingRelationships: Array<{ relationId: string, supplierId: string }>
}

interface State {
  commands: Map<string, ProjectSupplierImportCommandResultDTO>
  createdSupplierIds: Set<string>
  projects: Map<string, ProjectSupplierProjectSourceRow>
  relations: Map<string, ProjectSupplierRelationSourceRow>
  files: Map<string, ProjectSupplierFileSourceRow>
  payloads: Map<string, string>
  version: number
}

interface Options {
  createId?: (prefix: 'supplier' | 'project-supplier' | 'file') => string
  now?: () => string
  prepareSupplierAdoption?: (rows: readonly SupplierListSourceRow[], sessionId?: string | null) => SupplierImportAdoptionTransaction
  resolveSupplierRows?: (sessionId?: string | null) => readonly SupplierListSourceRow[]
  removeSuppliers?: (ids: readonly string[], sessionId?: string | null) => void
}

function fail(
  code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict' | 'relationship-mismatch',
  message: string,
): never {
  throw new ProjectSupplierRepositoryProblem(projectSupplierProblem(code, message))
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function payloadMatchesSize(value: string, expectedSize: number): boolean {
  if (value.length > 20_000_000 || value.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(value))
    return false
  const payload = Buffer.from(value, 'base64')
  return payload.toString('base64') === value && payload.byteLength === expectedSize
}

const allowedFileCategories = new Set<string>(PROJECT_SUPPLIER_FILE_CATEGORIES)

export function createProjectSupplierCommandTestInstance(options: Options = {}) {
  const states = new Map<string, State>()
  const createId = options.createId ?? (prefix => `${prefix}-${randomUUID()}`)
  const now = options.now ?? (() => new Date().toISOString())
  const prepareSupplierAdoption = options.prepareSupplierAdoption ?? (() => ({ commit() {}, rollback() {} }))
  const resolveSupplierRows = options.resolveSupplierRows ?? (() => [])
  const removeSuppliers = options.removeSuppliers ?? (() => {})
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = {
        commands: new Map(),
        createdSupplierIds: new Set(),
        projects: new Map(),
        relations: new Map(),
        files: new Map(),
        payloads: new Map(),
        version: 0,
      }
      states.set(key, state)
    }
    return state
  }

  function rows(sessionId?: string | null) {
    const state = stateFor(sessionId)
    const relatedSupplierIds = new Set([...state.relations.values()].map(relation => relation.supplierId))
    return {
      projects: [...state.projects.values()],
      suppliers: resolveSupplierRows(sessionId)
        .filter(row => row.dataOrigin === 'real' && relatedSupplierIds.has(row.id))
        .map((row): ProjectSupplierSupplierSourceRow => ({
          dataOrigin: 'real',
          id: row.id,
          name: row.name,
          supplierCategory: row.supplierCategory,
          contact: row.contact,
          contactPhone: row.contactPhone,
        })),
      relations: [...state.relations.values()],
      files: [...state.files.values()],
    }
  }

  return {
    reset(sessionId?: string | null) {
      const state = states.get(keyFor(sessionId))
      if (state)
        removeSuppliers([...state.createdSupplierIds], sessionId)
      states.delete(keyFor(sessionId))
    },
    sourceVersion(sessionId?: string | null) {
      return String(stateFor(sessionId).version)
    },
    rows,
    /** Internal central byte source. HTTP readers must validate current ancestors and owner first. */
    filePayload(fileId: string, origin: string, sessionId?: string | null) {
      if (origin !== 'real')
        return null
      const state = stateFor(sessionId)
      const file = state.files.get(fileId)
      const payloadBase64 = state.payloads.get(fileId)
      if (!file || payloadBase64 === undefined)
        return null
      return { payloadBase64, sha256: file.sha256 ?? null }
    },
    supplierProjectRows(sessionId?: string | null): {
      projects: SupplierProjectSourceRow[]
      relations: SupplierProjectRelationSourceRow[]
    } {
      const state = stateFor(sessionId)
      return {
        projects: [...state.projects.values()].map(project => ({
          dataOrigin: project.dataOrigin,
          id: project.id,
          name: project.name,
          status: project.status,
          permission: 'allowed',
        })),
        relations: [...state.relations.values()].map(relation => ({
          dataOrigin: relation.dataOrigin,
          id: relation.id,
          projectId: relation.projectId,
          supplierId: relation.supplierId,
          status: relation.status,
        })),
      }
    },
    async execute(
      request: ProjectSupplierImportCommandRequestDTO,
      session: BusinessSession,
      context: ProjectSupplierCommandExecutionContext,
      sessionId?: string | null,
    ): Promise<ProjectSupplierImportCommandResultDTO> {
      if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId)
        return fail('forbidden', '请求身份与当前会话不匹配')
      if (request.requiredCapability !== PROJECT_SUPPLIER_WRITE_CAPABILITY
        || !session.capabilities.includes(PROJECT_SUPPLIER_WRITE_CAPABILITY)) {
        return fail('forbidden', '无项目分供方导入权限')
      }
      if (!text(request.commandId) || !text(request.projectId) || request.projectId !== context.project.id)
        return fail('relationship-mismatch', '导入项目身份与中央项目不匹配')
      const state = stateFor(sessionId)
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return { ...duplicate }
      if (request.baseVersion !== String(state.version))
        return fail('conflict', '项目分供方关系已更新，请重新读取后再导入')

      const allowedSuppliers = new Map(context.suppliers.map(supplier => [supplier.id, supplier]))
      const existingRelationships = new Map(context.existingRelationships.map(row => [row.supplierId, row.relationId]))
      for (const relation of state.relations.values()) {
        if (relation.projectId === request.projectId)
          existingRelationships.set(relation.supplierId, relation.id)
      }
      const groups = new Map<string, ProjectSupplierImportCommandRequestDTO['groups'][number]>()
      for (const raw of request.groups) {
        const supplierId = text(raw.supplierId) || null
        const supplierName = text(raw.supplierName)
        if (supplierId && !allowedSuppliers.has(supplierId))
          return fail('relationship-mismatch', '选择的分供方不属于当前中央工作区')
        if (!supplierId && !supplierName)
          return fail('validation-failed', '新分供方名称不能为空')
        if (!Array.isArray(raw.files) || raw.files.length === 0)
          return fail('validation-failed', '每个分供方至少需要一个文件')
        for (const file of raw.files) {
          if (!text(file.fileName) || !Number.isSafeInteger(file.fileSize) || file.fileSize < 0
            || !allowedFileCategories.has(text(file.category))
            || !payloadMatchesSize(file.payloadBase64, file.fileSize)) {
            return fail('validation-failed', '导入文件元数据或正文无效')
          }
        }
        const key = supplierId ?? `new:${supplierName.toLocaleLowerCase('zh-CN')}`
        const prior = groups.get(key)
        groups.set(key, {
          supplierId,
          supplierName: supplierName || prior?.supplierName || allowedSuppliers.get(supplierId ?? '')?.name || '',
          files: [...(prior?.files ?? []), ...raw.files],
        })
      }
      if (groups.size === 0)
        return fail('validation-failed', '请选择至少一个文件')

      const timestamp = now()
      const nextProjects = new Map(state.projects)
      const nextCreatedSupplierIds = new Set(state.createdSupplierIds)
      const nextRelations = new Map(state.relations)
      const nextFiles = new Map(state.files)
      const nextPayloads = new Map(state.payloads)
      let createdSupplierCount = 0
      let reusedRelationshipCount = 0
      let fileCount = 0
      const suppliersToAdopt: SupplierListSourceRow[] = []

      nextProjects.set(context.project.id, {
        dataOrigin: 'real',
        id: context.project.id,
        name: context.project.name,
        status: '',
        developer: '',
        manager: '',
      })
      for (const group of groups.values()) {
        let supplierId = group.supplierId
        let supplierName = group.supplierName
        if (!supplierId) {
          supplierId = createId('supplier')
          supplierName = text(supplierName)
          createdSupplierCount += 1
          nextCreatedSupplierIds.add(supplierId)
          suppliersToAdopt.push({
            dataOrigin: 'real',
            id: supplierId,
            name: supplierName,
            aliases: [],
            externalRef: '',
            uniqueCode: '',
            taxNo: '',
            businessType: '',
            supplierCategory: '其他',
            rating: '',
            legalRep: '',
            registeredCapital: null,
            registeredDate: null,
            address: '',
            taxpayerType: '',
            mainBusiness: '',
            invoiceName: supplierName,
            invoiceAddress: '',
            bank: '',
            bankAccount: '',
            phone: '',
            contact: '',
            contactPhone: '',
            contactTitle: '',
            credentialStatus: 'incomplete',
            note: '由项目分供方文件导入创建',
            updatedAt: timestamp,
          })
        }
        let relationId = existingRelationships.get(supplierId)
        if (relationId) {
          reusedRelationshipCount += 1
        }
        else {
          relationId = createId('project-supplier')
          existingRelationships.set(supplierId, relationId)
          nextRelations.set(relationId, {
            dataOrigin: 'real',
            id: relationId,
            projectId: request.projectId,
            supplierId,
            status: 'collecting',
            note: '由文件导入创建',
          })
        }
        for (const file of group.files) {
          const fileId = createId('file')
          nextFiles.set(fileId, {
            dataOrigin: 'real',
            id: fileId,
            relationId,
            ownerType: 'project_supplier',
            ownerId: relationId,
            fileName: text(file.fileName),
            fileSize: file.fileSize,
            mimeType: text(file.mimeType),
            category: text(file.category),
            uploader: session.actorId,
            uploadedAt: timestamp,
            hasPayload: true,
            sha256: createHash('sha256').update(Buffer.from(file.payloadBase64, 'base64')).digest('hex'),
          })
          nextPayloads.set(fileId, file.payloadBase64)
          fileCount += 1
        }
      }

      const nextVersion = state.version + 1
      const result: ProjectSupplierImportCommandResultDTO = {
        commandId: request.commandId,
        version: String(nextVersion),
        updatedAt: timestamp,
        relationshipCount: groups.size,
        fileCount,
        createdSupplierCount,
        reusedRelationshipCount,
      }
      const nextCommands = new Map(state.commands)
      nextCommands.set(request.commandId, result)
      const supplierAdoption = prepareSupplierAdoption(suppliersToAdopt, sessionId)
      const previous = {
        commands: state.commands,
        createdSupplierIds: state.createdSupplierIds,
        projects: state.projects,
        relations: state.relations,
        files: state.files,
        payloads: state.payloads,
        version: state.version,
      }
      try {
        supplierAdoption.commit()
        state.commands = nextCommands
        state.createdSupplierIds = nextCreatedSupplierIds
        state.projects = nextProjects
        state.relations = nextRelations
        state.files = nextFiles
        state.payloads = nextPayloads
        state.version = nextVersion
      }
      catch (cause) {
        state.commands = previous.commands
        state.createdSupplierIds = previous.createdSupplierIds
        state.projects = previous.projects
        state.relations = previous.relations
        state.files = previous.files
        state.payloads = previous.payloads
        state.version = previous.version
        try {
          supplierAdoption.rollback()
        }
        catch {
          // Preserve the original central write failure after best-effort rollback.
        }
        throw cause
      }
      return { ...result }
    },
  }
}

export const projectSupplierCommandTestInstance = createProjectSupplierCommandTestInstance({
  prepareSupplierAdoption: (rows, sessionId) => supplierCommandTestInstance.prepareImportedSuppliers(rows, sessionId),
  resolveSupplierRows: sessionId => supplierCommandTestInstance.rows(sessionId),
  removeSuppliers: (ids, sessionId) => supplierCommandTestInstance.removeImportedSuppliers(ids, sessionId),
})
