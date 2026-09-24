import type { ImportColumnMatch, ImportStepId } from '~/lib/kit/import-mapping'
import type { ProjectFormDraft } from '~/lib/master-data/forms'
import type { RawImportSheet } from '~/lib/util/excel'
import { getImportEntity } from '~/lib/kit/import-entities'
import { autoMatchColumns, buildImportRows, computeFieldStatus, importStepperSteps, listMissingRequiredFields } from '~/lib/kit/import-mapping'
import { annotateProjectImportRows, projectImportSource } from '~/lib/project/import'

export function useProjectImport() {
  const fields = getImportEntity('project')!.fields
  const commands = useProjectCommandStore()
  const runner = useImportRunner()
  const sheet = shallowRef<RawImportSheet | null>(null)
  const mapping = shallowRef<Readonly<Record<string, ImportColumnMatch>>>({})
  const excluded = shallowRef<ReadonlySet<number>>(new Set())
  const step = shallowRef<ImportStepId>('upload')
  const preparing = shallowRef(false)
  const previewError = shallowRef('')
  const reviewed = shallowRef<Record<number, { draft?: ProjectFormDraft, error?: string }>>({})
  const saved = shallowRef<Array<{ index: number, id: string, name: string }>>([])
  const cancelled = shallowRef(false)
  let generation = 0
  let activeRun: ReturnType<typeof runner.start> | undefined
  const rows = computed(() => sheet.value ? annotateProjectImportRows(buildImportRows(mapping.value, sheet.value.rows), sheet.value) : [])
  const entries = computed(() => rows.value.map((row, index) => ({ row, index })).filter(entry => !excluded.value.has(entry.index)))
  const missing = computed(() => listMissingRequiredFields(mapping.value, fields))
  const fieldStatus = computed(() => computeFieldStatus(mapping.value, fields))
  const steps = computed(() => importStepperSteps({ currentStep: step.value, runPhase: runner.phase.value }))

  function loaded(parsed: RawImportSheet) {
    generation++
    sheet.value = parsed
    mapping.value = autoMatchColumns(parsed.columns, fields)
    excluded.value = new Set()
    reviewed.value = {}
    saved.value = []
    cancelled.value = false
    runner.reset()
    step.value = 'mapping'
  }
  function select(field: string, column: string | null) {
    if (preparing.value)
      return
    const next = { ...mapping.value }
    if (column)
      next[field] = { column, confidence: 'confirmed' }
    else delete next[field]
    mapping.value = next
  }
  function confirm(field: string) {
    if (preparing.value)
      return
    const match = mapping.value[field]
    if (match)
      mapping.value = { ...mapping.value, [field]: { ...match, confidence: 'confirmed' } }
  }
  async function preview() {
    if (missing.value.length || preparing.value)
      return
    const token = ++generation
    preparing.value = true
    previewError.value = ''
    const next: typeof reviewed.value = {}
    try {
      for (const entry of entries.value) {
        if (token !== generation)
          return
        const error = await commands.validateImportRow(entry.row)
        next[entry.index] = error ? { error } : { draft: (await commands.prepareImportRow(entry.row)).draft }
      }
      if (token !== generation)
        return
      reviewed.value = next
      step.value = 'preview-import'
    }
    catch (cause) {
      previewError.value = cause instanceof Error ? cause.message : '中央客户读取失败，请重试'
    }
    finally { preparing.value = false }
  }
  function remove(index: number) {
    if (runner.phase.value === 'idle')
      excluded.value = new Set([...excluded.value, index])
  }
  async function write(row: Record<string, unknown>) {
    const result = await commands.importRow(row)
    const index = rows.value.indexOf(row)
    if (!saved.value.some(item => item.index === index))
      saved.value = [...saved.value, { index, id: result.id, name: String(row.name) }]
  }
  async function start() {
    if (runner.phase.value !== 'idle' || preparing.value)
      return
    activeRun = runner.start(entries.value.map(entry => entry.row), write, commands.validateImportRow)
    return activeRun
  }
  async function retry() {
    if (runner.phase.value === 'failed')
      activeRun = runner.retry()
    else if (runner.phase.value === 'completed' && runner.rejected.value.length)
      activeRun = runner.start(runner.rejected.value.map(item => item.row), write, commands.validateImportRow)
    else return
    return activeRun
  }
  function cancel() {
    generation++
    cancelled.value = true
    runner.cancel()
  }
  async function stop() {
    cancel()
    await activeRun
  }
  onUnmounted(cancel)
  return { fields, sheet, mapping, excluded, step, preparing, previewError, reviewed, saved, cancelled, entries, missing, fieldStatus, steps, runner, loaded, select, confirm, preview, remove, start, retry, cancel, stop, source: projectImportSource }
}
