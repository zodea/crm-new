export type ExportPath = 'direct-save' | 'config-tab'

export interface ExportPathConfig {
  requiresDirectoryStructure: boolean
}

export interface ExportFileOptions {
  data: string | Uint8Array | ArrayBuffer
  defaultName: string
  mimeType?: string
}

export interface ExportDirectoryTarget {
  displayPath: string
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

function toBytes(data: ExportFileOptions['data']): Uint8Array {
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
  let target: ExportDirectoryTarget | null
  try {
    target = await environment.pickDirectory()
  }
  catch (error) {
    environment.feedback.failure(error)
    throw error
  }

  if (!target)
    return { status: 'cancelled' }

  await environment.feedback.during(
    () => target.writeFile(options.defaultName, toBytes(options.data), options.mimeType),
  )
  environment.feedback.success(`已导出到 ${target.displayPath} 文件夹`)

  return { status: 'exported', displayPath: target.displayPath }
}
