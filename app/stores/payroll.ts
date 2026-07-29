import type {
  PayrollWorkbenchOptions,
  WageFormatFamily,
  WagePeriodKind,
  WageStatement,
  WageStatementFilter,
  WageStatementPurpose,
} from '~/lib/payroll/statements'
import type { WageQuantitySource } from '~/lib/quantity/wage-source'
import { defineStore } from 'pinia'
import { getDb, withTransaction } from '~/lib/db/connection'
import { upsertC2SubjectConfig } from '~/lib/payroll/daywork'
import {
  buildWageDraftSource,
  checkWageStatement,
  createWageStatementDraft,
  listWageStatements,
  loadPayrollWorkbenchOptions,
  releaseWageStatement,
  updateDraftLinePrice,
} from '~/lib/payroll/statements'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export const usePayrollStore = defineStore('payroll-workbench', () => {
  const statements = shallowRef<WageStatement[]>([])
  const options = shallowRef<PayrollWorkbenchOptions>({
    projects: [],
    crews: [],
    workers: [],
    c2SubjectConfigs: [],
  })
  const selectedId = ref('')
  const loading = ref(false)
  const error = ref('')
  const filters = reactive<WageStatementFilter>({
    projectId: '',
    month: currentMonth(),
    status: '',
    crewId: '',
  })

  const selected = computed(() =>
    statements.value.find(statement => statement.id === selectedId.value) ?? null,
  )

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const db = await getDb()
      let nextOptions = await loadPayrollWorkbenchOptions(db, filters.projectId)
      if (!filters.projectId && nextOptions.projects[0])
        filters.projectId = nextOptions.projects[0].id
      if (filters.projectId)
        nextOptions = await loadPayrollWorkbenchOptions(db, filters.projectId)
      options.value = nextOptions
      statements.value = await listWageStatements(db, filters)
      if (!statements.value.some(statement => statement.id === selectedId.value))
        selectedId.value = statements.value[0]?.id ?? ''
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
    finally {
      loading.value = false
    }
  }

  async function createDraft(input: {
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
  }) {
    if (input.formatFamily === 'B')
      throw new Error('B 类合同清单直报尚未实现，不能按 A 类工程量代建工资单')
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
    if (!selected.value)
      return
    await withTransaction(tx => updateDraftLinePrice(tx, selected.value!.id, lineId, value))
    await load()
  }

  async function checkSelected() {
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

  async function releaseSelected(actualAmount: number) {
    if (!selected.value)
      return
    try {
      const statementId = selected.value.id
      const result = await withTransaction(tx => releaseWageStatement(tx, statementId, actualAmount))
      if (result === 'needs_recheck')
        throw new Error('现场工程量或考勤来源已变化，请重新核对后再发放')
    }
    finally {
      await load()
    }
  }

  return {
    statements,
    options,
    selectedId,
    selected,
    loading,
    error,
    filters,
    load,
    createDraft,
    updatePrice,
    checkSelected,
    releaseSelected,
  }
})
