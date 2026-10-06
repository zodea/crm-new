import type { DataOriginDTO, ProblemDTO, ReadMetaDTO } from '../../types/read-model'
import type { ProjectConstructionManagementFeeRead } from './construction-management-fee'
import type {
  ProjectDetailQueryDTO,
  ProjectListQueryDTO,
  ProjectListRepository,
  ProjectListSourceRow,
} from './repository'
import { isISODateTimeDTO } from '../../types/read-model'
import { attachOriginReadMeta, attachReadMeta, isReadMetaDTO } from '../read-model/meta'
import { readNativeProjectConstructionManagementFees } from './native-construction-management-fee'
import {
  buildProjectDetailRead,
  buildProjectListPage,
  projectProblem,
  projectProblemFromUnknown,
  ProjectRepositoryProblem,
} from './repository'

export interface ProjectSqliteGateway {
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

interface SqliteProjectRepositoryOptions {
  gateway: ProjectSqliteGateway
  canReadProjects?: boolean
  canReadCustomers?: boolean
  /** 仅同一 Native owner 明确授权后读取本机总合同配置。 */
  canReadConstructionContracts?: boolean
  canReadCustomer?: (id: string) => boolean
  canViewDemo: boolean
  dataOrigin: DataOriginDTO
  now?: () => string
  /** The SQLite snapshot owner supplies both source proofs from the same read, including excluded origins. */
  readEvidence: (input: { query: ProjectListQueryDTO | ProjectDetailQueryDTO, rows: readonly ProjectListSourceRow[], asOf: string, constructionManagementFees?: ProjectConstructionManagementFeeRead }) => Promise<Record<DataOriginDTO, ReadMetaDTO>> | Record<DataOriginDTO, ReadMetaDTO>
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function nullableText(value: unknown): string | null {
  const result = text(value)
  return result || null
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sourceRow(
  row: Record<string, unknown>,
  canReadCustomer: (id: string) => boolean,
  dataOrigin: DataOriginDTO,
): ProjectListSourceRow {
  const customerId = nullableText(row.customer_id)
  return {
    dataOrigin,
    id: text(row.id),
    name: text(row.name),
    code: text(row.code),
    status: text(row.status),
    contractAmount: nullableNumber(row.contract_amount),
    operationType: text(row.operation_type),
    startDate: nullableText(row.start_date),
    plannedEnd: nullableText(row.planned_end),
    actualEnd: nullableText(row.actual_end),
    plannedDuration: nullableNumber(row.planned_duration),
    manager: text(row.manager),
    execManager: text(row.exec_manager),
    builder: text(row.builder),
    customerId,
    customerName: nullableText(row.customer_name),
    customerPermission: !customerId || canReadCustomer(customerId) ? 'allowed' : 'forbidden',
    secondaryCustomerId: nullableText(row.secondary_customer_id),
    secondaryCustomerName: nullableText(row.secondary_customer_name),
    secondaryCustomerPermission: !nullableText(row.secondary_customer_id)
      || canReadCustomer(text(row.secondary_customer_id))
      ? 'allowed'
      : 'forbidden',
    contractName: text(row.contract_name),
    contractor: text(row.contractor),
    region: text(row.region),
    riskLevel: text(row.risk_level),
    address: text(row.address),
    income: nullableNumber(row.income),
    budget: nullableNumber(row.budget),
    updatedAt: text(row.updated_at),
  }
}

const PROJECT_LIST_SQL = `
  SELECT
    project.id,
    project.name,
    project.code,
    project.status,
    project.contract_amount,
    project.operation_type,
    project.start_date,
    project.planned_end,
    project.actual_end,
    project.planned_duration,
    project.manager,
    project.exec_manager,
    project.builder,
    project.customer_id,
    primary_customer.name AS customer_name,
    project.secondary_customer_id,
    secondary_customer.name AS secondary_customer_name,
    project.contract_name,
    project.contractor,
    project.region,
    project.risk_level,
    project.address,
    (
      SELECT SUM(receipt.amount)
      FROM receipt_registrations AS receipt
      WHERE receipt.project_id = project.id
        AND receipt.status NOT IN ('draft', '草稿')
        AND receipt.deleted_at IS NULL
    ) AS income,
    (
      SELECT target.tax_inclusive_total
      FROM target_costs AS target
      WHERE target.project_id = project.id
        AND target.is_baseline = 1
        AND target.status <> 'draft'
        AND target.deleted_at IS NULL
      ORDER BY target.updated_at DESC, target.id
      LIMIT 1
    ) AS budget,
    project.updated_at
  FROM projects AS project
  LEFT JOIN customers AS primary_customer
    ON primary_customer.id = project.customer_id
    AND primary_customer.deleted_at IS NULL
  LEFT JOIN customers AS secondary_customer
    ON secondary_customer.id = project.secondary_customer_id
    AND secondary_customer.deleted_at IS NULL
  WHERE project.deleted_at IS NULL
  ORDER BY project.id
`

export function createSqliteProjectListRepository(
  options: SqliteProjectRepositoryOptions,
): ProjectListRepository {
  function assertRead(includeDemo: boolean) {
    if (options.canReadProjects === false) {
      const problem: ProblemDTO = {
        code: 'forbidden',
        message: '无项目查看权限',
        retryable: false,
        fieldErrors: {},
        traceId: null,
      }
      throw new ProjectRepositoryProblem(problem)
    }
    if (includeDemo && !options.canViewDemo) {
      throw new ProjectRepositoryProblem({
        code: 'forbidden',
        message: '无测试数据查看权限',
        retryable: false,
        fieldErrors: {},
        traceId: null,
      })
    }
  }

  async function sourceRows(): Promise<ProjectListSourceRow[]> {
    const rows = await options.gateway.select<Record<string, unknown>>(PROJECT_LIST_SQL)
    const canReadCustomer = (id: string) => options.canReadCustomers !== false
      && (options.canReadCustomer?.(id) ?? true)
    return rows.map(row => sourceRow(row, canReadCustomer, options.dataOrigin))
  }

  async function evidence(query: ProjectListQueryDTO | ProjectDetailQueryDTO, rows: readonly ProjectListSourceRow[], asOf: string, constructionManagementFees?: ProjectConstructionManagementFeeRead) {
    if (!isISODateTimeDTO(asOf))
      throw new ProjectRepositoryProblem(projectProblem('internal-error', 'SQLite 快照读取时间无效'))
    const result = await options.readEvidence({ query, rows, asOf, ...(constructionManagementFees ? { constructionManagementFees } : {}) })
    if (!(['real', 'demo'] as const).every(origin => isReadMetaDTO(result[origin], 'project-read-v2') && result[origin].dataOrigin === origin && result[origin].asOf === asOf))
      throw new Error('SQLite 读取缺少同次可信证据')
    return result
  }

  return {
    async list(query: ProjectListQueryDTO) {
      try {
        assertRead(query.includeDemo)
        const rows = await sourceRows()
        const asOf = options.now?.() ?? new Date().toISOString()
        const readMeta = await evidence(query, rows, asOf)
        return attachOriginReadMeta(buildProjectListPage({
          rows,
          query,
          asOf,
          sourceVersion: readMeta[options.dataOrigin].sourceVersion,
          capabilities: readMeta[options.dataOrigin].capabilities,
        }), readMeta, options.dataOrigin)
      }
      catch (cause) {
        throw projectProblemFromUnknown(cause)
      }
    },
    async get(query: ProjectDetailQueryDTO) {
      try {
        assertRead(query.includeDemo)
        const rows = await sourceRows()
        const asOf = options.now?.() ?? new Date().toISOString()
        const configuration = options.dataOrigin === 'real' && query.origin === 'real' && options.canReadConstructionContracts === true
          ? await readNativeProjectConstructionManagementFees({ select: options.gateway.select, execute: async () => { throw new Error('Native 配置读取不能写入') } }, query.id, asOf)
          : undefined
        const readMeta = await evidence(query, rows, asOf, configuration)
        if (configuration && !readMeta.real.capabilities.includes('construction-contract:read'))
          throw new ProjectRepositoryProblem(projectProblem('forbidden', 'Native 总合同配置授权与读取证明不一致'))
        return attachReadMeta({ ...buildProjectDetailRead({
          rows,
          query,
          asOf,
          sourceVersion: readMeta[options.dataOrigin].sourceVersion,
          capabilities: readMeta[options.dataOrigin].capabilities,
        }), ...(configuration ? { constructionManagementFees: configuration } : {}) }, readMeta[options.dataOrigin])
      }
      catch (cause) {
        throw projectProblemFromUnknown(cause)
      }
    },
  }
}
