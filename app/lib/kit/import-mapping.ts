// 导入映射纯逻辑（ADR 0005 / 组件规格 §04）：
// 智能预匹配、三色态、必填门控、行投影与向导步态，全部无副作用便于单测。

export interface ImportTemplateField {
  key: string
  label: string
  required?: boolean
  aliases?: readonly string[]
}

export type ImportMatchConfidence = 'confirmed' | 'suggested'

export interface ImportColumnMatch {
  column: string
  confidence: ImportMatchConfidence
}

/**
 * 领域导入可以把来源证据挂在投影行上，而不把来源字段混进用户可映射的模板字段。
 * 该键使用不可枚举属性传递，导出拒绝清单时仍只输出业务列，来源证据由领域专用链路读取。
 */
export const IMPORT_SOURCE_META_KEY = '__importSource'

/** 写入前已经确定的业务拒绝，允许导入执行器继续处理其余行。 */
export class ImportRowRejected extends Error {}

/** 模板字段 key → 源列匹配；未匹配字段不出现。 */
export type ImportMapping = Readonly<Record<string, ImportColumnMatch>>

export type ImportFieldStatus = 'matched' | 'pending' | 'required-missing' | 'unmapped'

/** 每个实体导入模板预留的对账列（仿红圈 `field3__c 匹配标识`），存源系统主键。 */
export const EXTERNAL_REF_FIELD: ImportTemplateField = {
  key: 'externalRef',
  label: '外部旧ID / 匹配标识',
  required: false,
  aliases: ['匹配标识', '外部旧ID', '旧ID'],
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function fieldNames(field: ImportTemplateField): string[] {
  return [field.label, ...(field.aliases ?? [])].map(normalizeHeader)
}

/**
 * 智能预匹配：先按标签/别名精确认领（confirmed），再按包含关系给出
 * 待确认建议（suggested）；同一源列只被认领一次，精确优先。
 */
export function autoMatchColumns(
  sourceColumns: readonly string[],
  templateFields: readonly ImportTemplateField[],
): Record<string, ImportColumnMatch> {
  const mapping: Record<string, ImportColumnMatch> = {}
  const claimedColumns = new Set<string>()

  for (const field of templateFields) {
    const names = fieldNames(field)
    const column = sourceColumns.find(candidate =>
      !claimedColumns.has(candidate) && names.includes(normalizeHeader(candidate)),
    )
    if (column) {
      mapping[field.key] = { column, confidence: 'confirmed' }
      claimedColumns.add(column)
    }
  }

  for (const field of templateFields) {
    if (mapping[field.key])
      continue
    const names = fieldNames(field)
    const column = sourceColumns.find((candidate) => {
      if (claimedColumns.has(candidate))
        return false
      const normalized = normalizeHeader(candidate)
      return names.some(name =>
        name.length >= 2 && normalized.length >= 2
        && (normalized.includes(name) || name.includes(normalized)),
      )
    })
    if (column) {
      mapping[field.key] = { column, confidence: 'suggested' }
      claimedColumns.add(column)
    }
  }

  return mapping
}

/** 三色态：matched=--brand 已匹配、pending=--warn 待确认、required-missing=--danger 必填缺失；unmapped 为中性。 */
export function computeFieldStatus(
  mapping: ImportMapping,
  templateFields: readonly ImportTemplateField[],
): Record<string, ImportFieldStatus> {
  return Object.fromEntries(templateFields.map((field) => {
    const match = mapping[field.key]
    if (match)
      return [field.key, match.confidence === 'confirmed' ? 'matched' : 'pending']
    return [field.key, field.required ? 'required-missing' : 'unmapped']
  }))
}

/** 必填门控：返回未映上的必填字段，非空即拦住不进导入步。 */
export function listMissingRequiredFields(
  mapping: ImportMapping,
  templateFields: readonly ImportTemplateField[],
): ImportTemplateField[] {
  return templateFields.filter(field => field.required && !mapping[field.key])
}

/** 把源行按映射投影为模板字段行；源行缺列时该字段不出现。 */
export function buildImportRows(
  mapping: ImportMapping,
  sourceRows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const entries = Object.entries(mapping)
  return sourceRows.map((row) => {
    const mapped: Record<string, unknown> = {}
    for (const [key, match] of entries) {
      // hasOwn 而非 in：列名恰为原型键（toString/__proto__）时不得投影继承值。
      if (Object.hasOwn(row, match.column))
        mapped[key] = row[match.column]
    }
    const sourceMeta = row[IMPORT_SOURCE_META_KEY]
    if (sourceMeta !== undefined) {
      Object.defineProperty(mapped, IMPORT_SOURCE_META_KEY, {
        configurable: true,
        enumerable: false,
        value: sourceMeta,
        writable: false,
      })
    }
    return mapped
  })
}

export type ImportStepId = 'upload' | 'mapping' | 'preview-import'
export type ImportRunPhase = 'idle' | 'running' | 'completed' | 'failed'
export type ImportStepStatus = 'pending' | 'active' | 'completed' | 'failed'

export interface ImportWizardState {
  currentStep: ImportStepId
  runPhase: ImportRunPhase
}

export interface ImportStepperStep {
  id: ImportStepId
  label: string
  status: ImportStepStatus
}

const IMPORT_STEPS: readonly { id: ImportStepId, label: string }[] = [
  { id: 'upload', label: '上传' },
  { id: 'mapping', label: '映射' },
  { id: 'preview-import', label: '预览导入' },
]

/** 向导状态 → ProcessStepper 步态投影：导入执行只发生在第三步。 */
export function importStepperSteps(state: ImportWizardState): ImportStepperStep[] {
  const currentIndex = IMPORT_STEPS.findIndex(step => step.id === state.currentStep)
  return IMPORT_STEPS.map((step, index) => {
    if (index < currentIndex)
      return { ...step, status: 'completed' as const }
    if (index > currentIndex)
      return { ...step, status: 'pending' as const }
    if (step.id !== 'preview-import' || state.runPhase === 'idle')
      return { ...step, status: 'active' as const }
    return {
      ...step,
      status: state.runPhase === 'running' ? 'active' as const : state.runPhase,
    }
  })
}
