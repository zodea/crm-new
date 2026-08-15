import type { DataOriginDTO, ProblemDTO } from '../../types/read-model'
import type {
  ProjectDetailQueryDTO,
  ProjectListQueryDTO,
  ProjectListRepository,
  ProjectListSourceRow,
} from './repository'
import {
  buildProjectDetailRead,
  buildProjectListPage,
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
  canReadCustomer?: (id: string) => boolean
  canViewDemo: boolean
  dataOrigin: DataOriginDTO
  now?: () => string
  sourceVersion?: string | null
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

  return {
    async list(query: ProjectListQueryDTO) {
      try {
        assertRead(query.includeDemo)
        return buildProjectListPage({
          rows: await sourceRows(),
          query,
          asOf: options.now?.() ?? new Date().toISOString(),
          sourceVersion: options.sourceVersion ?? null,
        })
      }
      catch (cause) {
        throw projectProblemFromUnknown(cause)
      }
    },
    async get(query: ProjectDetailQueryDTO) {
      try {
        assertRead(query.includeDemo)
        return buildProjectDetailRead({
          rows: await sourceRows(),
          query,
          asOf: options.now?.() ?? new Date().toISOString(),
          sourceVersion: options.sourceVersion ?? null,
        })
      }
      catch (cause) {
        throw projectProblemFromUnknown(cause)
      }
    },
  }
}
