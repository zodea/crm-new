<script setup lang="ts">
import type { CrewExcelReviewEntry } from '~/components/crew-worker/CrewExcelReview.vue'
import type { WorkerExcelReviewEntry } from '~/components/crew-worker/WorkerExcelReview.vue'
import type { SupplierReviewEntry } from '~/components/supplier/SupplierImportReview.vue'
import type { ImportRowRejection, ImportRunResult } from '~/composables/useImportRunner'
import type { CrewExcelDraft, CrewExcelPreview } from '~/lib/crew-worker/excel-import-contract'
import type { WorkerExcelDraft, WorkerExcelPreview } from '~/lib/crew-worker/worker-excel-contract'
import type { ImportColumnMatch, ImportStepId } from '~/lib/kit/import-mapping'
import type { SupplierImportDraft, SupplierImportPreview } from '~/lib/supplier/command-contract'
import type { RawImportSheet } from '~/lib/util/excel'
import MaterialExcelImportScreen from '~/components/contract/MaterialExcelImportScreen.vue'
import CrewExcelReview from '~/components/crew-worker/CrewExcelReview.vue'
import WorkerExcelReview from '~/components/crew-worker/WorkerExcelReview.vue'
import SupplierImportReview from '~/components/supplier/SupplierImportReview.vue'
import { Button } from '~/components/ui/button'
import { crewExcelDuplicates, normalizeCrewExcelRow } from '~/lib/crew-worker/excel-import'
import { normalizeWorkerExcelRow, workerExcelDuplicates } from '~/lib/crew-worker/worker-excel-import'
import { annotateInvoiceImportRows, getInvoiceImportSourceMeta } from '~/lib/invoice/excel'
import { getImportEntity } from '~/lib/kit/import-entities'
import {
  autoMatchColumns,
  buildImportRows,
  computeFieldStatus,
  importStepperSteps,
  listMissingRequiredFields,
} from '~/lib/kit/import-mapping'
import { setSupplierImportDecision, setSupplierImportSource, supplierImportDraftFromRow, supplierImportSourceKey } from '~/lib/supplier/import-command'
import { supplierImportFileDuplicates } from '~/lib/supplier/import-review'
import ImportMappingStep from '~/pages/import/mapping/_components/ImportMappingStep.vue'
import ImportPreviewStep from '~/pages/import/mapping/_components/ImportPreviewStep.vue'
import ImportUploadStep from '~/pages/import/mapping/_components/ImportUploadStep.vue'
import InvoiceWorkbookUploadStep from '~/pages/import/mapping/_components/InvoiceWorkbookUploadStep.vue'
import ProjectImportScreen from '~/pages/import/mapping/_components/ProjectImportScreen.vue'
import { bindCrewExcelRow, crewExcelSourceKey, useCrewExcelImportStore } from '~/stores/crew-excel-import'
import { bindWorkerExcelRow, useWorkerExcelImportStore, workerExcelSourceKey } from '~/stores/worker-excel-import'

const route = useRoute()
const router = useRouter()
const baseURL = useRuntimeConfig().app.baseURL
const tabsStore = useTabsStore()
const toast = useToast()

// app.vue 以 fullPath 作为 page-key；此处捕获身份，不在 KeepAlive 实例中
// 持续读取全局 route.params，避免切换页签后串实体。
const entityKey = String(route.params.entity)
const tabFullPath = route.fullPath
const entity = getImportEntity(entityKey)
const fields = entity?.fields ?? []

const currentStep = shallowRef<ImportStepId>('upload')
const sheet = shallowRef<RawImportSheet | null>(null)
const mapping = shallowRef<Readonly<Record<string, ImportColumnMatch>>>({})
const excludedRows = shallowRef<ReadonlySet<number>>(new Set())
const runner = useImportRunner()
let instanceGeneration = 0
function instanceIsCurrent(generation: number) {
  return generation === instanceGeneration
}
const { done, error, phase, total } = runner
const { exportFile } = useKitUI()
const rowNumbers = new WeakMap<Record<string, unknown>, number>()
const invoiceStore = useInvoiceStore()
const supplierPrepared = shallowRef<ReadonlyMap<number, { draft: SupplierImportDraft, preview: SupplierImportPreview }>>(new Map())
const supplierChoices = shallowRef<Readonly<Record<number, string>>>({})
const supplierPreviewBusy = shallowRef(false)
const supplierPreviewError = shallowRef('')
const supplierRecoveryNotice = shallowRef('')
const crewPrepared = shallowRef<ReadonlyMap<number, { draft: CrewExcelDraft, preview: CrewExcelPreview }>>(new Map())
const crewChoices = shallowRef<Readonly<Record<number, string>>>({})
const crewPreviewBusy = shallowRef(false)
const crewStarting = shallowRef(false)
const crewPreviewError = shallowRef('')
const crewRecoveryNotice = shallowRef('')
const workerPrepared = shallowRef<ReadonlyMap<number, { draft: WorkerExcelDraft, preview: WorkerExcelPreview }>>(new Map())
const workerChoices = shallowRef<Readonly<Record<number, string>>>({})
const workerRelations = shallowRef<Readonly<Record<number, { crew?: string, project?: string }>>>({})
const workerPreviewBusy = shallowRef(false)
const workerPreviewError = shallowRef('')
const workerRecoveryNotice = shallowRef('')

const steps = computed(() => importStepperSteps({
  currentStep: currentStep.value,
  runPhase: phase.value,
}))
const fieldStatus = computed(() => computeFieldStatus(mapping.value, fields))
const missingRequired = computed(() => listMissingRequiredFields(mapping.value, fields))
const mappedRows = computed(() => buildImportRows(mapping.value, sheet.value?.rows ?? []))
const allRows = computed(() => entityKey === 'invoice'
  ? annotateInvoiceImportRows(mappedRows.value, invoiceStore.list.map(invoice => invoice.invoiceNumber))
  : mappedRows.value)
const keptEntries = computed(() => allRows.value
  .map((row, index) => ({ index, row }))
  .filter(entry => !excludedRows.value.has(entry.index)))
const sourceRowNumber = (index: number) => sheet.value?.rowNumbers?.[index] ?? (sheet.value?.headerRow ?? 0) + index + 2
const supplierDuplicates = computed(() => supplierImportFileDuplicates(keptEntries.value.flatMap(({ index }) => {
  const prepared = supplierPrepared.value.get(index)
  return prepared && supplierChoices.value[index] !== 'skip' ? [{ index, draft: prepared.draft }] : []
})))
const supplierReviewEntries = computed<SupplierReviewEntry[]>(() => keptEntries.value.flatMap(({ index }) => {
  const prepared = supplierPrepared.value.get(index)
  if (!prepared)
    return []
  const sameFileRows = supplierDuplicates.value.get(index) ?? []
  if (!prepared.preview.candidates.length && !sameFileRows.length && supplierChoices.value[index] !== 'skip')
    return []
  return [{ index, rowNumber: sourceRowNumber(index), row: prepared.draft as Record<string, unknown>, preview: prepared.preview, sameFileRows: sameFileRows.map(sourceRowNumber) }]
}))
const supplierNeedsReview = computed(() => supplierReviewEntries.value.some(({ index, preview, sameFileRows }) => {
  const choice = supplierChoices.value[index]
  const valid = choice === 'create' || (choice?.startsWith('replace:') && preview.candidates.some(candidate => candidate.id === choice.slice(8)))
  return choice !== 'skip' && (sameFileRows.length > 0 || (preview.candidates.length > 0 && !valid))
}))
const crewDuplicates = computed(() => crewExcelDuplicates(keptEntries.value.flatMap(({ index }) => {
  const prepared = crewPrepared.value.get(index)
  return prepared && crewChoices.value[index] !== 'skip' ? [{ index, draft: prepared.draft }] : []
})))
const crewReviewEntries = computed<CrewExcelReviewEntry[]>(() => keptEntries.value.flatMap(({ index }) => {
  const prepared = crewPrepared.value.get(index)
  if (!prepared)
    return []
  const sameFileRows = crewDuplicates.value.get(index) ?? []
  if (!prepared.preview.candidates.length && !sameFileRows.length && crewChoices.value[index] !== 'skip')
    return []
  return [{ index, rowNumber: sourceRowNumber(index), row: prepared.draft as Record<string, unknown>, preview: prepared.preview, sameFileRows: sameFileRows.map(sourceRowNumber) }]
}))
const crewNeedsReview = computed(() => crewReviewEntries.value.some(({ index, preview, sameFileRows }) => {
  const choice = crewChoices.value[index]
  const valid = choice === 'create' || (choice?.startsWith('replace:') && preview.candidates.some(candidate => candidate.id === choice.slice(8)))
  return choice !== 'skip' && (sameFileRows.length > 0 || (preview.candidates.length > 0 && !valid))
}))
const workerDuplicates = computed(() => workerExcelDuplicates(keptEntries.value.flatMap(({ index }) => {
  const prepared = workerPrepared.value.get(index)
  return prepared && workerChoices.value[index] !== 'skip' ? [{ index, draft: prepared.draft }] : []
})))
const workerReviewEntries = computed<WorkerExcelReviewEntry[]>(() => keptEntries.value.flatMap(({ index }) => {
  const prepared = workerPrepared.value.get(index)
  if (!prepared)
    return []
  const sameFileRows = workerDuplicates.value.get(index) ?? []
  if (!prepared.preview.candidates.length && !sameFileRows.length && !prepared.draft.crewName && !prepared.draft.projectName && workerChoices.value[index] !== 'skip')
    return []
  return [{ index, rowNumber: sourceRowNumber(index), row: prepared.draft as Record<string, unknown>, preview: prepared.preview, sameFileRows: sameFileRows.map(sourceRowNumber) }]
}))
const workerNeedsReview = computed(() => workerReviewEntries.value.some(({ index, row, preview, sameFileRows }) => {
  const choice = workerChoices.value[index]
  if (choice === 'skip')
    return false
  const valid = choice === 'create' || (choice?.startsWith('replace:') && preview.candidates.some(candidate => candidate.id === choice.slice(8)))
  const relation = workerRelations.value[index]
  return sameFileRows.length > 0 || (preview.candidates.length > 0 && !valid)
    || (!!row.crewName && !preview.crews.some(candidate => candidate.id === relation?.crew))
    || (!!row.projectName && !preview.projects.some(candidate => candidate.id === relation?.project))
}))
const importableEntries = computed(() => keptEntries.value.filter(entry => (entityKey !== 'supplier' || supplierChoices.value[entry.index] !== 'skip') && (entityKey !== 'crew' || crewChoices.value[entry.index] !== 'skip') && (entityKey !== 'worker' || workerChoices.value[entry.index] !== 'skip')))
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round((done.value / total.value) * 100))

// 预占式页签下该回填暂不生效（AppTabBar 静态标题最后覆盖），机制修复见 #98。
useTabTitle(() => entityKey === 'material-contract' ? '批量导入采购合同' : entity ? `导入映射 · ${entity.label}` : '导入映射')

function onLoaded(parsed: RawImportSheet) {
  sheet.value = parsed
  mapping.value = autoMatchColumns(parsed.columns, fields)
  excludedRows.value = new Set()
  runner.reset()
  currentStep.value = 'mapping'
}

function selectColumn(fieldKey: string, column: string | null) {
  const next = { ...mapping.value }
  if (column)
    next[fieldKey] = { column, confidence: 'confirmed' }
  else
    delete next[fieldKey]
  mapping.value = next
}

function confirmSuggestion(fieldKey: string) {
  const match = mapping.value[fieldKey]
  if (match)
    mapping.value = { ...mapping.value, [fieldKey]: { ...match, confidence: 'confirmed' } }
}

async function goPreview() {
  const generation = instanceGeneration
  if (missingRequired.value.length)
    return
  if (entityKey === 'supplier') {
    const selectedSheet = sheet.value
    const selectedMapping = mapping.value
    const selectedExclusions = excludedRows.value
    supplierPreviewBusy.value = true
    supplierPreviewError.value = ''
    supplierPrepared.value = new Map()
    supplierChoices.value = {}
    try {
      const recovered = await useSupplierCommandStore().recoverPendingImports()
      if (!instanceIsCurrent(generation))
        return
      if (recovered.applied || recovered.notApplied)
        supplierRecoveryNotice.value = `已核对上次导入：${recovered.applied} 行已保存，${recovered.notApplied} 行未保存。请重新核对本次预览后选择。`
      const valid = keptEntries.value.flatMap(({ index, row }) => {
        try {
          return [{ index, draft: supplierImportDraftFromRow(row) }]
        }
        catch { return [] }
      })
      const repository = useNuxtApp().$repositories.supplierCommands
      const before = await repository.context()
      if (!instanceIsCurrent(generation))
        return
      const batch = await repository.previewImport(valid.map(item => item.draft))
      if (!instanceIsCurrent(generation))
        return
      const after = await repository.context()
      if (!instanceIsCurrent(generation))
        return
      const expected = [...before.capabilities].sort().join('\0')
      if (batch.workspaceId !== before.workspaceId || batch.actorId !== before.actorId || after.workspaceId !== before.workspaceId || after.actorId !== before.actorId
        || [...batch.capabilities].sort().join('\0') !== expected || [...after.capabilities].sort().join('\0') !== expected
        || !before.capabilities.includes('supplier:write') || !before.capabilities.includes('supplier:list:read')) {
        throw new Error('预览期间身份、权限或资料来源变化，请重新预览')
      }
      if (sheet.value !== selectedSheet || mapping.value !== selectedMapping || excludedRows.value !== selectedExclusions)
        throw new Error('文件或映射已变化，请重新预览')
      supplierPrepared.value = new Map(valid.map((item, index) => [item.index, { draft: item.draft, preview: batch.previews[index]! }]))
    }
    catch (cause) {
      if (!instanceIsCurrent(generation))
        return
      supplierPreviewError.value = cause instanceof Error ? cause.message : '无法读取已有分供方，请重试'
      return
    }
    finally {
      if (instanceIsCurrent(generation))
        supplierPreviewBusy.value = false
    }
  }
  if (entityKey === 'crew') {
    const selectedSheet = sheet.value
    const selectedMapping = mapping.value
    const selectedExclusions = excludedRows.value
    crewPreviewBusy.value = true
    crewPreviewError.value = ''
    crewPrepared.value = new Map()
    crewChoices.value = {}
    try {
      const recovered = await useCrewExcelImportStore().recoverPending()
      if (!instanceIsCurrent(generation))
        return
      if (recovered.applied || recovered.notApplied)
        crewRecoveryNotice.value = `已核对上次导入：${recovered.applied} 行已保存，${recovered.notApplied} 行未保存。请重新核对本次预览后选择。`
      const valid = keptEntries.value.flatMap(({ index, row }) => {
        try {
          return [{ index, draft: normalizeCrewExcelRow(row) }]
        }
        catch { return [] }
      })
      const repository = useNuxtApp().$repositories.crewWorkerCommands
      const before = await repository.context()
      if (!instanceIsCurrent(generation))
        return
      const batch = await repository.previewCrewExcel(valid.map(item => item.draft))
      if (!instanceIsCurrent(generation))
        return
      const after = await repository.context()
      if (!instanceIsCurrent(generation))
        return
      const expected = [...before.capabilities].sort().join('\0')
      if (batch.workspaceId !== before.workspaceId || batch.actorId !== before.actorId || after.workspaceId !== before.workspaceId || after.actorId !== before.actorId
        || [...batch.capabilities].sort().join('\0') !== expected || [...after.capabilities].sort().join('\0') !== expected
        || !before.capabilities.includes('crew:write') || !before.capabilities.includes('crew:list:read')) {
        throw new Error('预览期间身份、权限或资料来源变化，请重新预览')
      }
      if (sheet.value !== selectedSheet || mapping.value !== selectedMapping || excludedRows.value !== selectedExclusions)
        throw new Error('文件或映射已变化，请重新预览')
      crewPrepared.value = new Map(valid.map((item, index) => [item.index, { draft: item.draft, preview: batch.previews[index]! }]))
    }
    catch (cause) {
      if (!instanceIsCurrent(generation))
        return
      crewPreviewError.value = cause instanceof Error ? cause.message : '无法读取已有班组，请重试'
      return
    }
    finally {
      if (instanceIsCurrent(generation))
        crewPreviewBusy.value = false
    }
  }
  if (entityKey === 'worker') {
    const selectedSheet = sheet.value
    const selectedMapping = mapping.value
    const selectedExclusions = excludedRows.value
    workerPreviewBusy.value = true
    workerPreviewError.value = ''
    workerPrepared.value = new Map()
    workerChoices.value = {}
    workerRelations.value = {}
    try {
      const recovered = await useWorkerExcelImportStore().recoverPending()
      if (!instanceIsCurrent(generation))
        return
      if (recovered.applied || recovered.notApplied)
        workerRecoveryNotice.value = `已核对上次导入：${recovered.applied} 行已保存，${recovered.notApplied} 行未保存。请重新核对本次预览后选择。`
      const valid = keptEntries.value.flatMap(({ index, row }) => {
        try {
          return [{ index, draft: normalizeWorkerExcelRow(row) }]
        }
        catch { return [] }
      })
      const repository = useNuxtApp().$repositories.crewWorkerCommands
      const before = await repository.context()
      if (!instanceIsCurrent(generation))
        return
      const batch = await repository.previewWorkerExcel(valid.map(item => item.draft))
      if (!instanceIsCurrent(generation))
        return
      const after = await repository.context()
      if (!instanceIsCurrent(generation))
        return
      const expected = [...before.capabilities].sort().join('\0')
      if (batch.workspaceId !== before.workspaceId || batch.actorId !== before.actorId || after.workspaceId !== before.workspaceId || after.actorId !== before.actorId
        || [...batch.capabilities].sort().join('\0') !== expected || [...after.capabilities].sort().join('\0') !== expected
        || !['worker:write', 'worker:list:read', 'worker:sensitive:read', 'crew:list:read'].every(capability => before.capabilities.includes(capability))) {
        throw new Error('预览期间身份、权限或资料来源变化，请重新预览')
      }
      if (sheet.value !== selectedSheet || mapping.value !== selectedMapping || excludedRows.value !== selectedExclusions)
        throw new Error('文件或映射已变化，请重新预览')
      workerPrepared.value = new Map(valid.map((item, index) => [item.index, { draft: item.draft, preview: batch.previews[index]! }]))
    }
    catch (cause) {
      if (!instanceIsCurrent(generation))
        return
      workerPreviewError.value = cause instanceof Error ? cause.message : '无法读取工人或关联资料，请重试'
      return
    }
    finally {
      if (instanceIsCurrent(generation))
        workerPreviewBusy.value = false
    }
  }
  currentStep.value = 'preview-import'
}

function chooseSupplier(index: number, value: string) {
  if (phase.value === 'idle')
    supplierChoices.value = { ...supplierChoices.value, [index]: value }
}
function chooseCrew(index: number, value: string) {
  if (phase.value === 'idle' && !crewStarting.value)
    crewChoices.value = { ...crewChoices.value, [index]: value }
}
function chooseWorker(index: number, value: string) {
  if (phase.value === 'idle' && !crewStarting.value)
    workerChoices.value = { ...workerChoices.value, [index]: value }
}
function chooseWorkerRelation(index: number, kind: 'crew' | 'project', value: string) {
  if (phase.value === 'idle' && !crewStarting.value)
    workerRelations.value = { ...workerRelations.value, [index]: { ...workerRelations.value[index], [kind]: value } }
}

function backToUpload() {
  currentStep.value = 'upload'
}

function backToMapping() {
  // 已开始导入（含失败半途）不允许回改映射，避免重复入库已成功行。
  if (phase.value !== 'idle' || crewStarting.value)
    return
  currentStep.value = 'mapping'
}

function removeRow(index: number) {
  if (phase.value !== 'idle' || crewStarting.value)
    return
  excludedRows.value = new Set([...excludedRows.value, index])
}

async function closeImportTab() {
  tabsStore.close(tabFullPath)
  if (router.currentRoute.value.fullPath === tabFullPath)
    await router.replace(tabsStore.activeFullPath)
}

async function settle(result: ImportRunResult, generation: number) {
  if (!instanceIsCurrent(generation))
    return
  if (result.status === 'completed') {
    if (result.rejected?.length) {
      toast.warning(`已处理 ${done.value} 行，${result.rejected.length} 行被拒绝：${entity!.label}`)
      return
    }
    toast.success(`已导入 ${done.value} 行：${entity!.label}`)
    await closeImportTab()
  }
}

async function startImport() {
  const generation = instanceGeneration
  if (!entity || phase.value === 'running' || crewStarting.value || !importableEntries.value.length || (entityKey === 'supplier' && supplierNeedsReview.value) || (entityKey === 'crew' && crewNeedsReview.value) || (entityKey === 'worker' && workerNeedsReview.value))
    return
  if (entityKey === 'supplier') {
    try {
      const source = sheet.value
      if (!source?.sourceHash)
        throw new Error('导入文件来源不完整，请重新选择文件')
      for (const entry of importableEntries.value) {
        const key = await supplierImportSourceKey(source.sourceHash, source.name, sourceRowNumber(entry.index))
        if (!instanceIsCurrent(generation))
          return
        setSupplierImportSource(entry.row, key)
      }
    }
    catch (cause) {
      if (!instanceIsCurrent(generation))
        return
      toast.error(cause instanceof Error ? cause.message : '无法核对导入来源')
      return
    }
  }
  if (entityKey === 'crew') {
    crewStarting.value = true
    try {
      const source = sheet.value
      const capturedMapping = mapping.value
      const capturedExclusions = excludedRows.value
      const capturedChoices = crewChoices.value
      if (!source?.sourceHash)
        throw new Error('导入文件来源不完整，请重新选择文件')
      for (const entry of importableEntries.value) {
        const prepared = crewPrepared.value.get(entry.index)
        if (!prepared)
          continue
        const choice = crewChoices.value[entry.index]
        const candidate = choice?.startsWith('replace:') ? prepared.preview.candidates.find(value => value.id === choice.slice(8)) : undefined
        const decision = candidate ? { kind: 'replace' as const, fingerprint: prepared.preview.fingerprint, id: candidate.id, version: candidate.version } : { kind: 'create' as const, fingerprint: prepared.preview.fingerprint }
        const key = await crewExcelSourceKey(source.sourceHash, source.name, sourceRowNumber(entry.index))
        if (!instanceIsCurrent(generation))
          return
        bindCrewExcelRow(entry.row, decision, key)
      }
      if (sheet.value !== source || mapping.value !== capturedMapping || excludedRows.value !== capturedExclusions || crewChoices.value !== capturedChoices)
        throw new Error('文件、映射或确认选择已变化，请重新预览')
    }
    catch (cause) {
      if (!instanceIsCurrent(generation))
        return
      crewStarting.value = false
      toast.error(cause instanceof Error ? cause.message : '无法核对导入来源')
      return
    }
  }
  if (entityKey === 'worker') {
    crewStarting.value = true
    try {
      const source = sheet.value
      const capturedMapping = mapping.value
      const capturedExclusions = excludedRows.value
      const capturedChoices = workerChoices.value
      const capturedRelations = workerRelations.value
      if (!source?.sourceHash)
        throw new Error('导入文件来源不完整，请重新选择文件')
      for (const entry of importableEntries.value) {
        const prepared = workerPrepared.value.get(entry.index)
        if (!prepared)
          continue
        const choice = workerChoices.value[entry.index]
        const target = choice?.startsWith('replace:') ? prepared.preview.candidates.find(value => value.id === choice.slice(8)) : undefined
        const relations = workerRelations.value[entry.index]
        const crew = prepared.preview.crews.find(value => value.id === relations?.crew)
        const project = prepared.preview.projects.find(value => value.id === relations?.project)
        const decision = { ...(target ? { kind: 'replace' as const, id: target.id, version: target.version } : { kind: 'create' as const }), fingerprint: prepared.preview.fingerprint, ...(crew ? { crew: { id: crew.id, version: crew.version } } : {}), ...(project ? { project: { id: project.id, version: project.version } } : {}) }
        const key = await workerExcelSourceKey(source.sourceHash, source.name, sourceRowNumber(entry.index))
        if (!instanceIsCurrent(generation))
          return
        bindWorkerExcelRow(entry.row, decision, key)
      }
      if (sheet.value !== source || mapping.value !== capturedMapping || excludedRows.value !== capturedExclusions || workerChoices.value !== capturedChoices || workerRelations.value !== capturedRelations)
        throw new Error('文件、映射或确认选择已变化，请重新预览')
    }
    catch (cause) {
      if (!instanceIsCurrent(generation))
        return
      crewStarting.value = false
      toast.error(cause instanceof Error ? cause.message : '无法核对导入来源')
      return
    }
  }
  for (const entry of importableEntries.value) {
    rowNumbers.set(entry.row, sourceRowNumber(entry.index))
    if (entityKey === 'supplier') {
      const prepared = supplierPrepared.value.get(entry.index)
      if (prepared) {
        const choice = supplierChoices.value[entry.index]
        const candidate = choice?.startsWith('replace:') ? prepared.preview.candidates.find(value => value.id === choice.slice(8)) : undefined
        setSupplierImportDecision(entry.row, candidate
          ? { kind: 'replace', fingerprint: prepared.preview.fingerprint, id: candidate.id, version: candidate.version }
          : { kind: 'create', fingerprint: prepared.preview.fingerprint })
      }
    }
  }
  try {
    await settle(await runner.start(
      importableEntries.value.map(entry => entry.row),
      entity.importRow,
      entity.validateRow,
    ), generation)
  }
  finally {
    if (instanceIsCurrent(generation))
      crewStarting.value = false
  }
}

async function recoverSupplierImport() {
  const generation = instanceGeneration
  try {
    const result = await useSupplierCommandStore().recoverPendingImports()
    if (!instanceIsCurrent(generation))
      return
    runner.reset()
    supplierRecoveryNotice.value = `已核对上次导入：${result.applied} 行已保存，${result.notApplied} 行未保存。请重新核对本次预览后选择。`
    currentStep.value = 'mapping'
  }
  catch (cause) {
    if (!instanceIsCurrent(generation))
      return
    toast.error(cause instanceof Error ? cause.message : '暂时无法核对原导入，请保留当前页面')
  }
}

async function recoverCrewImport() {
  const generation = instanceGeneration
  try {
    const result = await useCrewExcelImportStore().recoverPending()
    if (!instanceIsCurrent(generation))
      return
    runner.reset()
    crewRecoveryNotice.value = `已核对上次导入：${result.applied} 行已保存，${result.notApplied} 行未保存。请重新核对本次预览后选择。`
    currentStep.value = 'mapping'
  }
  catch (cause) {
    if (instanceIsCurrent(generation))
      toast.error(cause instanceof Error ? cause.message : '暂时无法核对原导入，请保留当前页面')
  }
}
async function recoverWorkerImport() {
  const generation = instanceGeneration
  try {
    const result = await useWorkerExcelImportStore().recoverPending()
    if (!instanceIsCurrent(generation))
      return
    runner.reset()
    workerRecoveryNotice.value = `已核对上次导入：${result.applied} 行已保存，${result.notApplied} 行未保存。请重新核对本次预览后选择。`
    currentStep.value = 'mapping'
  }
  catch (cause) {
    if (instanceIsCurrent(generation))
      toast.error(cause instanceof Error ? cause.message : '暂时无法核对原导入，请保留当前页面')
  }
}

async function retryImport() {
  const generation = instanceGeneration
  if (phase.value === 'running')
    return
  await settle(await runner.retry(), generation)
}

function rejectionRowNumber(rejection: ImportRowRejection): number {
  const sourceRow = getInvoiceImportSourceMeta(rejection.row)?.sourceRow
  if (entityKey === 'invoice' && sourceRow)
    return sourceRow
  return rowNumbers.get(rejection.row) ?? rejection.index + 2
}

function rejectionKey(rejection: ImportRowRejection): string {
  const row = rejection.row
  return String(row.invoiceNumber ?? row.orderNo ?? row.name ?? row.externalRef ?? '—')
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

async function downloadRejections() {
  const generation = instanceGeneration
  if (!runner.rejected.value.length)
    return
  const originalKeys = [...new Set(runner.rejected.value.flatMap(rejection => Object.keys(rejection.row)))]
  const invoiceRejectionColumns = entityKey === 'invoice'
    ? ['来源文件', '来源Sheet', '来源原始行', '来源键', '复核原因']
    : []
  const lines = [
    ['原始行号', '关键值', '拒绝原因', ...invoiceRejectionColumns, ...originalKeys].map(csvCell).join(','),
    ...runner.rejected.value.map(rejection => [
      rejectionRowNumber(rejection),
      rejectionKey(rejection),
      rejection.reason,
      ...(entityKey === 'invoice'
        ? (() => {
            const source = getInvoiceImportSourceMeta(rejection.row)
            return [source?.sourceFileName ?? '', source?.sourceSheet ?? '', source?.sourceRow ?? '', source?.sourceKey ?? '', source?.reviewReasons.join('；') ?? '']
          })()
        : []),
      ...originalKeys.map(key => rejection.row[key]),
    ].map(csvCell).join(',')),
  ]
  try {
    await exportFile({
      data: `\ufeff${lines.join('\r\n')}`,
      defaultName: `${entity?.label ?? '导入'}_拒绝清单.csv`,
      mimeType: 'text/csv;charset=utf-8',
    })
  }
  catch (cause) {
    if (!instanceIsCurrent(generation))
      return
    toast.error(cause instanceof Error ? `拒绝清单下载失败：${cause.message}` : '拒绝清单下载失败')
  }
}

// 页签被 X 关闭/卸载时停止后台入库：当前行完成后不再推进，
// 避免卸载后静默失败或对已关页签弹结果。
onUnmounted(() => {
  instanceGeneration++
  runner.cancel()
})
</script>

<template>
  <MaterialExcelImportScreen v-if="entityKey === 'material-contract'" />
  <ProjectImportScreen v-else-if="entityKey === 'project'" />
  <main v-else class="mx-auto max-w-4xl py-3" aria-labelledby="import-mapping-title">
    <template v-if="entity">
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="mb-1 flex items-center gap-2 text-brand">
            <span class="i-lucide-file-input h-4 w-4" aria-hidden="true" />
            <span class="text-11px font-700 tracking-wide uppercase">Import workflow</span>
          </div>
          <h1 id="import-mapping-title" class="text-18px text-ink font-800">
            导入映射
          </h1>
          <p class="mt-1 text-12px text-ink-soft">
            {{ entity.label }} · 模板驱动，源列映射到系统字段
          </p>
        </div>
        <span class="chip-brand">独立页签 · 完成后自动关闭</span>
      </header>

      <div class="mb-5 border border-line rounded-[var(--radius-card)] bg-panel p-4">
        <ProcessStepper :steps="steps" />
      </div>

      <section v-if="currentStep === 'upload'" aria-label="第一步：上传">
        <p v-if="entityKey === 'crew'" class="mb-3 text-12px text-ink-soft">
          先下载并填写 <a :href="`${baseURL}templates/crew-excel-template.xlsx`" download="班组批量导入模板.xlsx" class="text-brand underline">班组 Excel 参考模板</a>；填写后选择“班组资料”工作表。
        </p>
        <p v-if="entityKey === 'worker'" class="mb-3 text-12px text-ink-soft">
          先下载并填写 <a :href="`${baseURL}templates/worker-excel-template.xlsx`" download="工人批量导入模板.xlsx" class="text-brand underline">工人 Excel 参考模板</a>；填写后选择“工人资料”工作表。
        </p>
        <InvoiceWorkbookUploadStep v-if="entityKey === 'invoice'" @loaded="onLoaded" />
        <ImportUploadStep v-else @loaded="onLoaded" />
        <div class="mt-4 flex justify-end">
          <Button variant="ghost" @click="closeImportTab">
            取消
          </Button>
        </div>
      </section>

      <section v-else-if="currentStep === 'mapping'" aria-label="第二步：映射">
        <ImportMappingStep
          :fields="fields"
          :columns="sheet?.columns ?? []"
          :mapping="mapping"
          :status="fieldStatus"
          @select="selectColumn"
          @confirm="confirmSuggestion"
        />
        <p v-if="supplierPreviewError" role="alert" class="mt-2 text-12px text-danger">
          {{ supplierPreviewError }}
        </p>
        <p v-if="supplierRecoveryNotice" role="status" class="mt-2 text-12px text-ink-soft">
          {{ supplierRecoveryNotice }}
        </p>
        <p v-if="crewPreviewError" role="alert" class="mt-2 text-12px text-danger">
          {{ crewPreviewError }}
        </p>
        <p v-if="crewRecoveryNotice" role="status" class="mt-2 text-12px text-ink-soft">
          {{ crewRecoveryNotice }}
        </p>
        <p v-if="workerPreviewError" role="alert" class="mt-2 text-12px text-danger">
          {{ workerPreviewError }}
        </p>
        <p v-if="workerRecoveryNotice" role="status" class="mt-2 text-12px text-ink-soft">
          {{ workerRecoveryNotice }}
        </p>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3">
          <p
            v-if="missingRequired.length"
            class="text-11px text-danger-ink font-600"
            role="alert"
          >
            必填字段未映射：{{ missingRequired.map(field => field.label).join('、') }}
          </p>
          <p v-else class="text-11px text-ink-faint">
            必填字段已全部映上，可进入预览。
          </p>
          <div class="flex items-center gap-2">
            <Button variant="ghost" @click="closeImportTab">
              取消
            </Button>
            <Button variant="outline" @click="backToUpload">
              重新上传
            </Button>
            <KitButton variant="primary" :disabled="missingRequired.length > 0 || supplierPreviewBusy || crewPreviewBusy || workerPreviewBusy" :loading="supplierPreviewBusy || crewPreviewBusy || workerPreviewBusy" @click="goPreview">
              下一步
            </KitButton>
          </div>
        </div>
      </section>

      <section v-else aria-label="第三步：预览与导入">
        <ImportPreviewStep
          :fields="fields"
          :entries="keptEntries"
          :removed-count="excludedRows.size"
          :locked="phase !== 'idle'"
          @remove="removeRow"
        />
        <SupplierImportReview v-if="entityKey === 'supplier'" :entries="supplierReviewEntries" :fields="fields" :choices="supplierChoices" :locked="phase !== 'idle'" @choose="chooseSupplier" />
        <CrewExcelReview v-if="entityKey === 'crew'" :entries="crewReviewEntries" :fields="fields" :choices="crewChoices" :locked="phase !== 'idle' || crewStarting" @choose="chooseCrew" />
        <WorkerExcelReview v-if="entityKey === 'worker'" :entries="workerReviewEntries" :fields="fields" :choices="workerChoices" :relations="workerRelations" :locked="phase !== 'idle' || crewStarting" @choose="chooseWorker" @relation="chooseWorkerRelation" />
        <p v-if="supplierRecoveryNotice" role="status" class="mt-2 text-12px text-ink-soft">
          {{ supplierRecoveryNotice }}
        </p>
        <p v-if="crewRecoveryNotice" role="status" class="mt-2 text-12px text-ink-soft">
          {{ crewRecoveryNotice }}
        </p>
        <p v-if="workerRecoveryNotice" role="status" class="mt-2 text-12px text-ink-soft">
          {{ workerRecoveryNotice }}
        </p>

        <div
          v-if="phase !== 'idle'"
          class="mt-4 border border-line rounded-[var(--radius-card)] bg-panel p-3"
        >
          <div class="mb-1.5 flex items-center justify-between gap-3 text-12px">
            <span class="text-ink-soft font-600">导入进度</span>
            <span class="text-ink font-mono tabular-nums" aria-live="polite">
              {{ done }}/{{ total }} 行
            </span>
          </div>
          <ProgressBar
            :percent="progressPercent"
            :tone="phase === 'failed' ? 'danger' : phase === 'completed' ? 'ok' : 'brand'"
            label="导入进度"
            :valuetext="`已导入 ${done}/${total} 行`"
          />
        </div>

        <section
          v-if="runner.rejected.value.length"
          class="mt-4 border border-warn/35 rounded-[var(--radius-card)] bg-warn-soft p-3"
          aria-label="行级拒绝清单"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-13px text-warn-ink font-800">
                {{ runner.rejected.value.length }} 行未导入
              </h2>
              <p class="mt-1 text-11px text-ink-soft">
                可预期的业务问题按行拒绝，其余行已经继续处理；修正原文件后可重新导入。
              </p>
            </div>
            <button type="button" class="btn-secondary" @click="downloadRejections">
              <span class="i-lucide-download mr-1" aria-hidden="true" />下载拒绝清单
            </button>
          </div>
          <div class="mt-3 max-h-52 overflow-auto border border-warn/25 rounded-[var(--radius-btn)] bg-panel">
            <table class="w-full border-collapse text-11px">
              <thead class="sticky top-0 bg-surface-2 text-left text-ink-soft">
                <tr>
                  <th class="px-3 py-2 font-700">
                    原始行
                  </th>
                  <th class="px-3 py-2 font-700">
                    关键值
                  </th>
                  <th class="px-3 py-2 font-700">
                    拒绝原因
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rejection in runner.rejected.value" :key="`${rejection.index}-${rejection.reason}`" class="border-t border-line">
                  <td class="px-3 py-2 font-mono tabular-nums">
                    {{ rejectionRowNumber(rejection) }}
                  </td>
                  <td class="max-w-52 truncate px-3 py-2" :title="rejectionKey(rejection)">
                    {{ rejectionKey(rejection) }}
                  </td>
                  <td class="px-3 py-2 text-warn-ink">
                    {{ rejection.reason }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div
          v-if="phase === 'failed'"
          class="mt-4 border border-danger/35 rounded-[var(--radius-btn)] bg-danger-soft p-3"
          role="alert"
        >
          <p class="text-13px text-danger-ink font-700">
            {{ error || '导入失败，请重试' }}
          </p>
          <p class="mt-1 text-11px text-ink-soft">
            已成功的 {{ done }} 行不会重复导入，重试将从失败行继续。
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <KitButton variant="danger" @click="retryImport">
              重试失败行
            </KitButton>
            <Button v-if="entityKey === 'supplier'" variant="outline" @click="recoverSupplierImport">
              核对原提交并重新预览
            </Button>
            <Button v-if="entityKey === 'crew'" variant="outline" @click="recoverCrewImport">
              核对原提交并重新预览
            </Button>
            <Button v-if="entityKey === 'worker'" variant="outline" @click="recoverWorkerImport">
              核对原提交并重新预览
            </Button>
            <Button variant="ghost" @click="closeImportTab">
              取消
            </Button>
          </div>
        </div>

        <div
          v-else
          class="mt-4 flex flex-wrap items-center justify-between gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3"
        >
          <p class="text-11px text-ink-faint">
            开始后逐行写入，本页显示进度；失败保留页签并可从失败行续导。
          </p>
          <div class="flex items-center gap-2">
            <Button variant="ghost" :disabled="phase === 'running'" @click="closeImportTab">
              取消
            </Button>
            <Button variant="outline" :disabled="phase !== 'idle'" @click="backToMapping">
              上一步
            </Button>
            <KitButton
              variant="accent"
              :disabled="!importableEntries.length || crewStarting || (entityKey === 'supplier' && supplierNeedsReview) || (entityKey === 'crew' && crewNeedsReview) || (entityKey === 'worker' && workerNeedsReview)"
              :loading="phase === 'running'"
              @click="startImport"
            >
              开始导入
            </KitButton>
          </div>
        </div>
      </section>
    </template>

    <section
      v-else
      class="border border-warn/40 rounded-[var(--radius-card)] bg-warn-soft p-6 text-center"
      role="alert"
    >
      <span class="i-lucide-file-warning mx-auto mb-2 h-7 w-7 text-warn" aria-hidden="true" />
      <h1 id="import-mapping-title" class="text-15px text-warn-ink font-800">
        导入实体未登记
      </h1>
      <p class="mx-auto mt-2 max-w-lg text-12px text-ink-soft">
        「{{ entityKey }}」不在导入实体注册表中，请从对应实体的列表页重新发起导入。
      </p>
      <Button class="mt-4" @click="closeImportTab">
        关闭此页签
      </Button>
    </section>
  </main>
</template>
