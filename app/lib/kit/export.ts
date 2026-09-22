export type ExportPath = 'direct-save' | 'config-tab'

export interface ExportPathConfig {
  requiresDirectoryStructure: boolean
}

export type ExportSampleRow = Readonly<Record<string, unknown>>

export interface ExportNamePart {
  field: string
  fallback?: string
  takeLast?: number
}

export interface NamingRuleCfg {
  parts: readonly ExportNamePart[]
  separator?: string
  extension?: string
}

export interface ExportFolderLevel {
  field: string
  fallback?: string
}

export interface TwoLevelFolderCfg {
  levels: readonly ExportFolderLevel[]
}

export type ExportData = string | Uint8Array | ArrayBuffer

export interface ConfiguredExportField {
  key: string
  label: string
}

export interface ConfiguredExportSourceFile {
  row: ExportSampleRow
  data: ExportData
  mimeType?: string
}

export interface ConfiguredExportSource {
  label: string
  fields: readonly ConfiguredExportField[]
  files: readonly ConfiguredExportSourceFile[]
}

export interface ConfiguredExportPlanOptions {
  source: ConfiguredExportSource
  structure: TwoLevelFolderCfg
  naming: NamingRuleCfg
}

export interface ConfiguredExportSettings {
  structure: TwoLevelFolderCfg
  naming: NamingRuleCfg
}

export interface ConfiguredExportFile {
  relativePath: string
  data: ExportData
  mimeType?: string
}

export type ExportStepId = 'read-data' | 'generate-files' | 'write-disk'
export type ExportStepStatus = 'pending' | 'active' | 'completed' | 'failed'
export type ExportStepperPhase = 'idle' | 'running' | 'completed' | 'failed'

export interface ExportStepperStep {
  id: ExportStepId
  label: string
  status: ExportStepStatus
}

export interface ExportStepperState {
  phase: ExportStepperPhase
  steps: readonly ExportStepperStep[]
}

export type ExportStepperEvent
  = | { type: 'start' }
    | { type: 'complete' }
    | { type: 'fail' }
    | { type: 'retry' }

export interface ExportFileOptions {
  /** 惰性正文在用户选定保存位置后读取，保留浏览器目录选择需要的用户激活。 */
  data: ExportData | (() => Promise<ExportData>)
  defaultName: string
  mimeType?: string
  /** Stops stale source exports before disk writing begins; it cannot undo an in-flight native write. */
  signal?: AbortSignal
}

export interface ExportDirectoryTarget {
  displayPath: string
  /** false 表示浏览器标准下载只能扁平落盘，不能冒充已创建目录结构。必填，避免新落点忘记声明时被误放行。 */
  supportsSubdirectories: boolean
  writeFile: (name: string, data: Uint8Array, mimeType?: string) => Promise<void>
}

export interface ExportFeedback {
  during: <T>(task: () => Promise<T>) => Promise<T>
  success: (message: string) => void
  failure: (error: unknown) => void
}

export interface ExportEnvironment {
  pickDirectory: () => Promise<ExportDirectoryTarget | null>
  feedback: ExportFeedback
}

export type ExportFileResult
  = | { status: 'cancelled' }
    | { status: 'exported', displayPath: string }

export function chooseExportPath(config: ExportPathConfig): ExportPath {
  return config.requiresDirectoryStructure ? 'config-tab' : 'direct-save'
}

function renderFieldPart(part: ExportNamePart, row: ExportSampleRow): string {
  if (part.takeLast != null && (!Number.isInteger(part.takeLast) || part.takeLast <= 0))
    throw new RangeError('命名规则的后 N 位必须是正整数')

  const rawValue = row[part.field]
  const value = String(rawValue == null || rawValue === ''
    ? (part.fallback ?? '')
    : rawValue).trim()

  // 按码点取后 N 位，避免 slice 按码元劈开星平面字符留下孤立代理。
  const rendered = part.takeLast == null
    ? value
    : Array.from(value).slice(-part.takeLast).join('')

  return sanitizePathSegment(rendered)
    || sanitizePathSegment(part.fallback ?? '未命名')
}

const MAX_PATH_SEGMENT_LENGTH = 255
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i

function replaceControlCharacters(value: string): string {
  return Array.from(value, character => character.charCodeAt(0) < 32 ? '-' : character).join('')
}

function truncatePathSegment(value: string, maxLength: number): string {
  if (value.length <= maxLength)
    return value

  let truncated = value.slice(0, maxLength)
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1)

  if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF)
    truncated = truncated.slice(0, -1)

  // 清洗发生在截断前；若截断点恰落在中间的点或空格上，需再次去尾，
  // 否则 Windows 仍会拒绝该路径组件。
  return truncated.replace(/[.\s]+$/g, '')
}

function sanitizePathSegment(
  value: unknown,
  maxLength = MAX_PATH_SEGMENT_LENGTH,
): string {
  const sanitized = replaceControlCharacters(String(value ?? ''))
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/[.\s]+$/g, '')

  const truncated = truncatePathSegment(sanitized, maxLength)
  const nonReserved = WINDOWS_RESERVED_NAME.test(truncated)
    ? `_${truncated}`
    : truncated

  return truncatePathSegment(nonReserved, maxLength)
}

export function renderNamePreview(rule: NamingRuleCfg, sampleRow: ExportSampleRow): string {
  const separator = rule.separator ?? '-'
  const extension = sanitizePathSegment(
    rule.extension?.replace(/^\.+/, ''),
    MAX_PATH_SEGMENT_LENGTH - 2,
  )
  const suffix = extension ? `.${extension}` : ''
  const maxNameLength = MAX_PATH_SEGMENT_LENGTH - suffix.length
  const name = sanitizePathSegment(
    rule.parts.map(part => renderFieldPart(part, sampleRow)).join(separator),
    maxNameLength,
  ) || truncatePathSegment('未命名', maxNameLength)

  return `${name}${suffix}`
}

export function resolveTwoLevelFolderPath(
  config: TwoLevelFolderCfg,
  row: ExportSampleRow,
): string[] {
  if (config.levels.length > 2)
    throw new RangeError('导出目录结构最多支持两级')

  return config.levels.map((level) => {
    const rawValue = row[level.field]
    const value = rawValue == null || rawValue === ''
      ? (level.fallback ?? '未分类')
      : rawValue

    return sanitizePathSegment(value)
      || sanitizePathSegment(level.fallback ?? '未分类')
      || '未分类'
  })
}

/** 给同名文件追加 ` (2)`、` (3)` 序号；平台写盘层对磁盘已有文件复用同一规则。 */
export function appendCollisionSuffix(fileName: string, sequence: number): string {
  const suffix = ` (${sequence})`
  const dotIndex = fileName.lastIndexOf('.')
  const rawStem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const rawExtension = dotIndex > 0 ? fileName.slice(dotIndex + 1) : ''
  const extension = truncatePathSegment(
    rawExtension,
    Math.max(0, MAX_PATH_SEGMENT_LENGTH - suffix.length - 2),
  )
  const extensionSuffix = extension ? `.${extension}` : ''
  const stem = truncatePathSegment(
    rawStem,
    Math.max(1, MAX_PATH_SEGMENT_LENGTH - suffix.length - extensionSuffix.length),
  ) || '文'

  return `${stem}${suffix}${extensionSuffix}`
}

/** Windows 文件系统按大小写不敏感 + Unicode 规范化等价判定同名。 */
function windowsPathEquivalenceKey(relativePath: string): string {
  return relativePath.normalize('NFC').toLowerCase()
}

/** 将可序列化导出上下文编译为安全、不会互相覆盖的相对写盘计划。 */
export function buildConfiguredExportFiles(
  options: ConfiguredExportPlanOptions,
): ConfiguredExportFile[] {
  const usedPathKeys = new Set<string>()

  return options.source.files.map((file) => {
    const folders = resolveTwoLevelFolderPath(options.structure, file.row)
    const originalName = renderNamePreview(options.naming, file.row)
    let sequence = 1
    let fileName = originalName
    let relativePath = [...folders, fileName].join('/')

    while (usedPathKeys.has(windowsPathEquivalenceKey(relativePath))) {
      sequence += 1
      fileName = appendCollisionSuffix(originalName, sequence)
      relativePath = [...folders, fileName].join('/')
    }
    usedPathKeys.add(windowsPathEquivalenceKey(relativePath))

    return {
      relativePath,
      data: file.data,
      mimeType: file.mimeType,
    }
  })
}

const EXPORT_STEPS: readonly Omit<ExportStepperStep, 'status'>[] = [
  { id: 'read-data', label: '读数据' },
  { id: 'generate-files', label: '生成' },
  { id: 'write-disk', label: '写盘' },
]

export function createExportStepper(): ExportStepperState {
  return {
    phase: 'idle',
    steps: EXPORT_STEPS.map(step => ({ ...step, status: 'pending' })),
  }
}

export function transitionExportStepper(
  state: ExportStepperState,
  event: ExportStepperEvent,
): ExportStepperState {
  if (event.type === 'start' && state.phase === 'idle') {
    return {
      phase: 'running',
      steps: state.steps.map((step, index) => ({
        ...step,
        status: index === 0 ? 'active' : 'pending',
      })),
    }
  }

  if (event.type === 'complete' && state.phase === 'running') {
    const activeIndex = state.steps.findIndex(step => step.status === 'active')
    if (activeIndex !== -1) {
      const isLastStep = activeIndex === state.steps.length - 1

      return {
        phase: isLastStep ? 'completed' : 'running',
        steps: state.steps.map((step, index) => ({
          ...step,
          status: index === activeIndex
            ? 'completed'
            : index === activeIndex + 1
              ? 'active'
              : step.status,
        })),
      }
    }
  }

  if (event.type === 'fail' && state.phase === 'running') {
    const activeIndex = state.steps.findIndex(step => step.status === 'active')
    if (activeIndex !== -1) {
      return {
        phase: 'failed',
        steps: state.steps.map((step, index) => ({
          ...step,
          status: index === activeIndex ? 'failed' : step.status,
        })),
      }
    }
  }

  if (event.type === 'retry' && state.phase === 'failed') {
    const failedIndex = state.steps.findIndex(step => step.status === 'failed')
    if (failedIndex !== -1) {
      return {
        phase: 'running',
        steps: state.steps.map((step, index) => ({
          ...step,
          status: index === failedIndex ? 'active' : step.status,
        })),
      }
    }
  }

  throw new Error(`导出进度无法从 ${state.phase} 执行 ${event.type}`)
}

export function exportDataToBytes(data: ExportData): Uint8Array {
  if (typeof data === 'string')
    return new TextEncoder().encode(data)

  if (data instanceof Uint8Array)
    return data

  return new Uint8Array(data)
}

export async function exportFile(
  options: ExportFileOptions,
  environment: ExportEnvironment,
): Promise<ExportFileResult> {
  if (options.signal?.aborted)
    return { status: 'cancelled' }
  let target: ExportDirectoryTarget | null
  try {
    target = await environment.pickDirectory()
  }
  catch (error) {
    if (options.signal?.aborted)
      return { status: 'cancelled' }
    environment.feedback.failure(error)
    throw error
  }

  if (!target || options.signal?.aborted)
    return { status: 'cancelled' }

  const written = await environment.feedback.during(async () => {
    if (options.signal?.aborted)
      return false
    let data: ExportData
    try {
      data = typeof options.data === 'function' ? await options.data() : options.data
    }
    catch (error) {
      if (options.signal?.aborted)
        return false
      throw error
    }
    if (options.signal?.aborted)
      return false
    await target.writeFile(options.defaultName, exportDataToBytes(data), options.mimeType)
    return true
  })
  if (!written)
    return { status: 'cancelled' }
  if (!options.signal?.aborted)
    environment.feedback.success(`已导出到 ${target.displayPath} 文件夹`)

  return { status: 'exported', displayPath: target.displayPath }
}
