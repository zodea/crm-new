import type { PayrollQuery } from '~/lib/payroll/central-contract'
import type {
  PayrollWorkbenchOptions,
  WageAllocationInput,
  WageFormatFamily,
  WagePeriodKind,
  WageStatement,
  WageStatementFilter,
  WageStatementPurpose,
} from '~/lib/payroll/statements'
import type { WageQuantitySource } from '~/lib/quantity/wage-source'
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import { getDb, withTransaction } from '~/lib/db/connection'
import { upsertC2SubjectConfig } from '~/lib/payroll/daywork'
import { payrollScopeFromOptions } from '~/lib/payroll/navigation'
import { loadPayrollListRead, requirePayrollNative } from '~/lib/payroll/platform-read'
import {
  buildWageDraftSource,
  checkWageStatement,
  createWageStatementDraft,
  listWageStatements,
  loadPayrollWorkbenchOptions,
  releaseWageStatement,
  updateDraftLinePrice,
} from '~/lib/payroll/statements'
import { useDataVisibilityStore } from './data-visibility'
import { usePayrollAStore } from './payroll-a'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export interface PayrollDraftCreateInput {
  projectId: string
  crewId?: string | null
  leaderWorkerId: string
  month: string
  purpose: WageStatementPurpose
  periodKind: WagePeriodKind
  formatFamily: WageFormatFamily
  quantitySource: WageQuantitySource
  payRatio: number
  memberWorkerIds: string[]
  dailyRate?: number
  overtimeRate?: number
  c2Rate?: number
  dayworkRuleText?: string
  adjustmentReason?: string
  operatorName?: string
}

export const usePayrollStore = defineStore('payroll-workbench', () => {
  const centralA = usePayrollAStore()
  const statements = shallowRef<WageStatement[]>([])
  const options = shallowRef<PayrollWorkbenchOptions>({
    projects: [],
    crews: [],
    workers: [],
    c2SubjectConfigs: [],
  })
  const selectedId = ref('')
  const loading = ref(false)
  const hasSnapshot = ref(false)
  let snapshotScope = ''
  const error = ref('')
  let loadSequence = 0
  const filters = reactive<WageStatementFilter>({
    projectId: '',
    month: currentMonth(),
    status: '',
    crewId: '',
  })

  const selected = computed(() =>
    statements.value.find(statement => statement.id === selectedId.value) ?? null,
  )

  const scopeKey = (value: WageStatementFilter) => JSON.stringify([value.projectId ?? '', value.month ?? '', value.crewId ?? ''])

  async function resolveOptions(projectId: string) {
    requirePayrollNative()
    const db = await getDb()
    let resolvedProjectId = projectId
    let nextOptions = await loadPayrollWorkbenchOptions(db, resolvedProjectId)
    const normalized = payrollScopeFromOptions({ projectId }, nextOptions)
    if (resolvedProjectId !== normalized.projectId) {
      resolvedProjectId = normalized.projectId
      nextOptions = await loadPayrollWorkbenchOptions(db, resolvedProjectId)
    }
    return { db, resolvedProjectId, nextOptions }
  }

  async function loadOptions(projectId = filters.projectId ?? '') {
    const sequence = ++loadSequence
    loading.value = true
    error.value = ''
    try {
      const { resolvedProjectId, nextOptions } = await resolveOptions(projectId)
      if (sequence !== loadSequence)
        return nextOptions
      filters.projectId = resolvedProjectId
      filters.crewId = payrollScopeFromOptions(filters, nextOptions).crewId
      options.value = nextOptions
      return nextOptions
    }
    catch (cause) {
      if (sequence !== loadSequence)
        return options.value
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
    finally {
      if (sequence === loadSequence)
        loading.value = false
    }
  }

  async function load() {
    const sequence = ++loadSequence
    const requestedFilters: WageStatementFilter = { ...filters }
    const isCurrentRead = () => sequence === loadSequence
      && scopeKey(filters) === scopeKey(requestedFilters)
      && JSON.stringify(filters.status) === JSON.stringify(requestedFilters.status)
    loading.value = true
    error.value = ''
    if (snapshotScope !== scopeKey(requestedFilters)) {
      statements.value = []
      hasSnapshot.value = false
      snapshotScope = ''
    }
    selectedId.value = ''
    try {
      const { db, resolvedProjectId, nextOptions } = await resolveOptions(requestedFilters.projectId ?? '')
      const nextFilters: WageStatementFilter = {
        ...requestedFilters,
        ...payrollScopeFromOptions({ ...requestedFilters, projectId: resolvedProjectId }, nextOptions),
      }
      const nextStatements = await listWageStatements(db, nextFilters)
      if (!isCurrentRead())
        return
      Object.assign(filters, nextFilters)
      options.value = nextOptions
      statements.value = nextStatements
      snapshotScope = scopeKey(nextFilters)
      hasSnapshot.value = true
      if (!statements.value.some(statement => statement.id === selectedId.value))
        selectedId.value = statements.value[0]?.id ?? ''
    }
    catch (cause) {
      if (isCurrentRead())
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
    finally {
      if (sequence === loadSequence)
        loading.value = false
    }
  }

  async function createDraft(input: PayrollDraftCreateInput) {
    requirePayrollNative()
    if (input.formatFamily === 'B')
      throw new Error('B 类工资已退役，请选择 A、C1 或 C2')
    const id = await withTransaction(async (tx) => {
      const subjectConfigId = input.formatFamily === 'C2'
        ? await upsertC2SubjectConfig(tx, {
            projectId: input.projectId,
            crewId: input.crewId,
            leaderWorkerId: input.leaderWorkerId,
            unitRate: Number(input.c2Rate ?? 0),
            ruleText: input.dayworkRuleText ?? '',
          })
        : null
      const source = await buildWageDraftSource(tx, {
        ...input,
        subjectConfigId,
      })
      if (!source.lines.length) {
        throw new Error(input.formatFamily === 'C2'
          ? '当前责任范围没有已确认签工记录，不能生成空工资单'
          : '当前责任范围没有对应口径的工程量，不能生成空工资单')
      }
      return createWageStatementDraft(tx, {
        ...input,
        subjectConfigId,
        lines: source.lines,
        sourceVersion: source.sourceVersion,
        sourceUpdatedAt: source.sourceUpdatedAt,
        sourceRecordIds: source.sourceRecordIds,
        note: source.subjectConfig?.ruleText,
      }, { withinTransaction: true })
    })
    filters.projectId = input.projectId
    filters.month = input.month
    await load()
    selectedId.value = id
  }

  async function updatePrice(lineId: string, value: number) {
    requirePayrollNative()
    if (!selected.value)
      return
    await withTransaction(tx => updateDraftLinePrice(tx, selected.value!.id, lineId, value))
    await load()
  }

  async function checkSelected() {
    requirePayrollNative()
    if (!selected.value)
      return
    const statement = selected.value
    const prices = new Map(statement.lines.map(line => [
      `${line.workerId}:${line.itemId ?? line.itemName}`,
      line.unitPrice,
    ]))
    const fallbackRatesByWorker = Object.fromEntries(statement.memberWorkerIds.map((workerId) => {
      const dailyRate = statement.lines.find(line =>
        line.workerId === workerId && line.itemName === '计时工资',
      )?.unitPrice ?? 0
      return [workerId, {
        dailyRate,
        overtimeRate: statement.lines.find(line =>
          line.workerId === workerId && line.itemName === '加班工资',
        )?.unitPrice ?? dailyRate / 8,
      }]
    }))
    await withTransaction(async (tx) => {
      const source = await buildWageDraftSource(tx, {
        projectId: statement.projectId,
        crewId: statement.crewId,
        leaderWorkerId: statement.leaderWorkerId,
        memberWorkerIds: statement.memberWorkerIds,
        month: statement.month,
        formatFamily: statement.formatFamily,
        quantitySource: 'field',
        dailyRate: statement.lines.find(line => line.itemName === '计时工资')?.unitPrice,
        overtimeRate: statement.lines.find(line => line.itemName === '加班工资')?.unitPrice,
        fallbackRatesByWorker,
        subjectConfigId: statement.subjectConfigId,
        statementId: statement.id,
      })
      const checkedLines = statement.formatFamily === 'C1' || statement.formatFamily === 'C2'
        ? source.lines
        : source.lines.map(line => ({
            ...line,
            unitPrice: prices.get(`${line.workerId}:${line.itemId ?? line.itemName}`) ?? 0,
          }))
      await checkWageStatement(tx, statement.id, checkedLines, {
        sourceVersion: source.sourceVersion,
        sourceUpdatedAt: source.sourceUpdatedAt,
        sourceRecordIds: source.sourceRecordIds,
        subjectConfig: source.subjectConfig,
      }, { withinTransaction: true })
    })
    await load()
  }

  async function releaseSelected(
    actualAmount: number,
    allocations: readonly WageAllocationInput[] = [],
  ) {
    requirePayrollNative()
    if (!selected.value)
      return
    try {
      const statementId = selected.value.id
      const result = await withTransaction(tx =>
        releaseWageStatement(tx, statementId, actualAmount, {}, allocations),
      )
      if (result === 'needs_recheck')
        throw new Error('现场工程量或考勤来源已变化，请重新核对后再发放')
    }
    finally {
      await load()
    }
  }

  return {
    loadAForm: centralA.loadAForm,
    loadAConfig: centralA.loadAConfig,
    loadAOutput: centralA.loadAOutput,
    saveADraft: centralA.saveADraft,
    checkA: centralA.checkA,
    setAPayRatio: centralA.setAPayRatio,
    releaseA: centralA.releaseA,
    saveASubjectConfig: centralA.saveASubjectConfig,
    saveAPrices: centralA.saveAPrices,
    getAPending: centralA.getAPending,
    recoverA: centralA.recoverA,
    acknowledgeA: centralA.acknowledgeA,
    aSaving: computed(() => centralA.aSaving),
    loadRead: (query: PayrollQuery) => loadPayrollListRead(useNuxtApp().$repositories.payroll, { ...query, includeDemo: useDataVisibilityStore().includeDemo }),
    statements,
    options,
    selectedId,
    selected,
    loading,
    hasSnapshot,
    error,
    filters,
    load,
    loadOptions,
    createDraft,
    updatePrice,
    checkSelected,
    releaseSelected,
  }
})
