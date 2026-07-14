import type { ComputedRef, MaybeRefOrGetter, ShallowRef } from 'vue'
import type {
  ConfiguredExportFile,
  ConfiguredExportSettings,
  ConfiguredExportSource,
  ExportDirectoryTarget,
  ExportStepperState,
} from '~/lib/kit/export'
import { computed, nextTick, shallowRef, toValue } from 'vue'
import {
  buildConfiguredExportFiles,
  createExportStepper,
  exportDataToBytes,
  transitionExportStepper,
} from '~/lib/kit/export'
import { pickExportDirectory } from '~/lib/platform/export-directory'
import { toErrorMessage } from '~/lib/util/error'

export type ConfiguredExportRunResult
  = | { status: 'cancelled' }
    | { status: 'exported', displayPath: string }
    | { status: 'failed', error: unknown }

export interface ConfiguredExportRunnerEnvironment {
  pickDirectory: () => Promise<ExportDirectoryTarget | null>
  /** 注入 seam：生产中让 Vue 提交一次 DOM，单测可用立即 resolved。 */
  yieldToView: () => Promise<void>
}

export interface ConfiguredExportRunner {
  stepper: ShallowRef<ExportStepperState>
  error: ShallowRef<string | null>
  running: Readonly<ComputedRef<boolean>>
  start: () => Promise<ConfiguredExportRunResult>
  retry: () => Promise<ConfiguredExportRunResult>
  reset: () => void
}

export function useConfiguredExportRunner(
  source: MaybeRefOrGetter<ConfiguredExportSource>,
  settings: MaybeRefOrGetter<ConfiguredExportSettings>,
  environment: ConfiguredExportRunnerEnvironment = {
    pickDirectory: () => pickExportDirectory({ recursive: true }),
    yieldToView: () => nextTick(),
  },
): ConfiguredExportRunner {
  const stepper = shallowRef(createExportStepper())
  const error = shallowRef<string | null>(null)
  const running = computed(() => stepper.value.phase === 'running')
  let preparedFiles: ConfiguredExportFile[] | null = null
  let displayPath: string | null = null
  // 已成功写出的文件（按落点 displayPath 记账）：重试同一目录时跳过续写，
  // 避免写盘层「绝不覆盖」把已写文件再落成 ` (2)` 副本。
  const writtenPaths = new Set<string>()
  let writtenDisplayPath: string | null = null

  function reset() {
    stepper.value = createExportStepper()
    error.value = null
    preparedFiles = null
    displayPath = null
    writtenPaths.clear()
    writtenDisplayPath = null
  }

  async function readData() {
    if (!toValue(source).files.length)
      throw new Error('没有可导出的文件')
  }

  async function generateFiles() {
    preparedFiles = buildConfiguredExportFiles({
      source: toValue(source),
      ...toValue(settings),
    })
  }

  async function writeDisk(): Promise<'written' | 'cancelled'> {
    if (!preparedFiles)
      throw new Error('导出文件尚未生成')

    const target = await environment.pickDirectory()
    if (!target)
      return 'cancelled'

    if (target.supportsSubdirectories === false)
      throw new Error('当前浏览器不支持保留目录结构，请使用桌面端或支持目录访问的浏览器')

    if (writtenDisplayPath !== target.displayPath) {
      writtenPaths.clear()
      writtenDisplayPath = target.displayPath
    }
    for (const file of preparedFiles) {
      if (writtenPaths.has(file.relativePath))
        continue
      await target.writeFile(
        file.relativePath,
        exportDataToBytes(file.data),
        file.mimeType,
      )
      writtenPaths.add(file.relativePath)
    }
    displayPath = target.displayPath
    return 'written'
  }

  async function runActiveSteps(): Promise<ConfiguredExportRunResult> {
    while (stepper.value.phase === 'running') {
      await environment.yieldToView()
      const activeStep = stepper.value.steps.find(step => step.status === 'active')
      if (!activeStep)
        throw new Error('导出进度缺少激活步骤')

      try {
        if (activeStep.id === 'read-data') {
          await readData()
        }
        else if (activeStep.id === 'generate-files') {
          await generateFiles()
        }
        else if (await writeDisk() === 'cancelled') {
          reset()
          return { status: 'cancelled' }
        }

        stepper.value = transitionExportStepper(stepper.value, { type: 'complete' })
      }
      catch (cause) {
        stepper.value = transitionExportStepper(stepper.value, { type: 'fail' })
        error.value = toErrorMessage(cause)
        return { status: 'failed', error: cause }
      }
    }

    if (!displayPath)
      throw new Error('导出完成但缺少写盘落点')
    return { status: 'exported', displayPath }
  }

  async function start() {
    if (running.value)
      throw new Error('导出正在进行中')
    reset()
    stepper.value = transitionExportStepper(stepper.value, { type: 'start' })
    return await runActiveSteps()
  }

  async function retry() {
    if (stepper.value.phase !== 'failed')
      throw new Error('只有失败的导出可以重试')
    error.value = null
    stepper.value = transitionExportStepper(stepper.value, { type: 'retry' })
    return await runActiveSteps()
  }

  return {
    stepper,
    error,
    running,
    start,
    retry,
    reset,
  }
}
