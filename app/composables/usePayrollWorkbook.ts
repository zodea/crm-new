import type { PayrollListRead } from '~/lib/payroll/central-contract'
import type { PayrollWorkbookArchive, PayrollWorkbookArchiveSummary, PayrollWorkbookInput, PayrollWorkbookPreview } from '~/lib/payroll/central-workbook-contract'
import type { WorkerRosterArchiveSummary } from '~/lib/worker-roster/contract'
import { useEventListener } from '@vueuse/core'
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { assertPayrollWorkbookRead, createPayrollSavedArchive, createPayrollSavedWorkbook } from '~/lib/payroll/workbook-export'
import { payrollWorkbookSubjectKey, payrollWorkbookSubjectLabel } from '~/lib/payroll/workbook-subject'
import { toErrorMessage } from '~/lib/util/error'
import { WORKER_PRIVATE_READ } from '~/lib/worker-roster/contract'
import { usePayrollWorkbookStore } from '~/stores/payroll-workbook'

export function usePayrollWorkbook() {
  const route = useRoute()
  const router = useRouter()
  const kit = useKitUI()
  const store = usePayrollWorkbookStore()
  const roster = useNuxtApp().$repositories.workerRoster
  const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
  const mode = shallowRef<PayrollWorkbookInput['mode']>(route.query.mode === 'project-month' ? 'project-month' : 'leader-cycle')
  const subjectKey = shallowRef(typeof route.query.subject === 'string' ? route.query.subject : '')
  const rosterArchiveId = shallowRef(typeof route.query.roster === 'string' ? route.query.roster : '')
  const list = shallowRef<PayrollListRead | null>(null)
  const previews = shallowRef<PayrollWorkbookPreview | null>(null)
  const opened = shallowRef<PayrollWorkbookArchive | null>(null)
  const versions = shallowRef<PayrollWorkbookArchiveSummary[]>([])
  const rosters = shallowRef<WorkerRosterArchiveSummary[]>([])
  const busy = shallowRef(false)
  const error = shallowRef('')
  let generation = 0
  const privateReadable = computed(() => !!list.value?.context.capabilities.includes(WORKER_PRIVATE_READ))
  const rows = computed(() => list.value?.rows.filter(row => row.projectId === projectId.value && row.recordKind === 'central' && row.status === 'released' && !row.hidden && !row.deletedAt && ['A', 'C1', 'C2'].includes(row.formatFamily)) ?? [])
  const subjects = computed(() => [...new Map(rows.value.map(row => [payrollWorkbookSubjectKey(row), { key: payrollWorkbookSubjectKey(row), label: payrollWorkbookSubjectLabel(row) }])).values()])
  const selected = computed(() => mode.value === 'project-month' ? rows.value : rows.value.filter(row => payrollWorkbookSubjectKey(row) === subjectKey.value))
  const selectedIds = computed(() => selected.value.map(row => row.id).sort())
  const matchingRosters = computed(() => rosters.value.filter(row => JSON.stringify([...row.statementIds].sort()) === JSON.stringify(selectedIds.value)))
  const canSave = computed(() => !!previews.value?.eligibility.canSave && !busy.value && !store.pending)
  const current = computed(() => opened.value ?? previews.value)
  const returnTo = computed(() => router.resolve({ path: '/subcontract/payroll/workbooks', query: { origin: 'real', project: projectId.value, mode: mode.value, subject: subjectKey.value || undefined, roster: rosterArchiveId.value || undefined, archive: opened.value?.id } }).fullPath)
  const rosterTo = computed(() => ({ path: '/subcontract/payroll/roster', query: { origin: 'real', project: projectId.value, statement: selectedIds.value, returnTo: returnTo.value } }))
  function clearReads() {
    list.value = null
    previews.value = null
    opened.value = null
    versions.value = []
    rosters.value = []
  }
  function failed(cause: unknown) {
    error.value = toErrorMessage(cause)
    // A failed authorized read must never leave a previously read private projection on screen.
    previews.value = null
    opened.value = null
  }
  async function load() {
    const token = ++generation
    const requestedProject = projectId.value
    busy.value = true
    error.value = ''
    clearReads()
    try {
      const value = await store.repository.list({ origin: 'real', ...(requestedProject ? { projectId: requestedProject } : {}) })
      if (token !== generation)
        return
      const [saved, privateVersions] = requestedProject
        ? await Promise.all([
            store.repository.workbookArchives({ origin: 'real', projectId: requestedProject }, { projectId: requestedProject }),
            value.context.capabilities.includes(WORKER_PRIVATE_READ) ? roster.archives(requestedProject) : Promise.resolve([]),
          ])
        : [[], []]
      if (token !== generation)
        return
      const archiveId = typeof route.query.archive === 'string' ? route.query.archive : ''
      const archived = archiveId && requestedProject ? await store.repository.workbookArchive({ origin: 'real', projectId: requestedProject }, { projectId: requestedProject, archiveId }) : null
      if (token !== generation)
        return
      list.value = value
      versions.value = saved
      rosters.value = privateVersions
      opened.value = archived
    }
    catch (cause) {
      if (token === generation)
        failed(cause)
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function buildPreview() {
    if (busy.value || store.pending || !selectedIds.value.length)
      return
    const token = generation
    busy.value = true
    error.value = ''
    opened.value = null
    try {
      const value = await store.repository.workbookPreview({ origin: 'real', projectId: projectId.value }, { projectId: projectId.value, mode: mode.value, statementIds: selectedIds.value, rosterArchiveId: rosterArchiveId.value || null })
      if (token === generation)
        previews.value = value
    }
    catch (cause) {
      if (token === generation)
        failed(cause)
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function open(archiveId: string) {
    if (busy.value || store.pending)
      return
    const token = generation
    busy.value = true
    error.value = ''
    previews.value = null
    opened.value = null
    try {
      const value = await store.repository.workbookArchive({ origin: 'real', projectId: projectId.value }, { projectId: projectId.value, archiveId })
      if (token === generation) {
        opened.value = value
        await router.replace({ path: route.path, query: { ...route.query, archive: value.id } })
      }
    }
    catch (cause) {
      if (token === generation)
        failed(cause)
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function save() {
    const value = previews.value
    if (!value || !canSave.value)
      return
    const token = generation
    busy.value = true
    error.value = ''
    try {
      const result = await store.execute({ schemaVersion: 1, commandId: `payroll-workbook-${crypto.randomUUID()}`, workspaceId: value.context.workspaceId, actorId: value.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: value.sourceVersion, input: value.input, action: 'archive' })
      if (token !== generation)
        return
      const read = await store.repository.workbookArchive({ origin: 'real', projectId: value.input.projectId }, { projectId: value.input.projectId, archiveId: result.archiveId })
      if (token !== generation)
        return
      if (read.manifestHash !== result.manifestHash || read.version !== result.version || read.context.workspaceId !== value.context.workspaceId || read.context.actorId !== value.context.actorId)
        throw new Error('目录尚未按原保存回执读回，请核对原提交')
      opened.value = read
      previews.value = null
      const saved = await store.repository.workbookArchives({ origin: 'real', projectId: value.input.projectId }, { projectId: value.input.projectId })
      if (token !== generation)
        return
      versions.value = saved
      store.acknowledge()
      await router.replace({ path: route.path, query: { ...route.query, archive: read.id } })
      kit.success('工资目录已保存；文件尚未下载')
    }
    catch (cause) {
      if (token === generation)
        failed(cause)
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function recover() {
    if (busy.value || !list.value)
      return
    const token = generation
    busy.value = true
    error.value = ''
    try {
      const result = await store.recover(list.value.context)
      if (token !== generation || !result)
        return
      if (result.archive && result.archive.input.projectId !== projectId.value)
        throw new Error('原目录属于其他项目，请切回原项目核对')
      opened.value = result.archive
      previews.value = null
      store.acknowledge()
      if (result.archive)
        await router.replace({ path: route.path, query: { ...route.query, archive: result.archive.id } })
      kit.success(result.archive ? '已读回原保存目录，没有重新保存或占号' : '原提交未保存，请重新预览')
    }
    catch (cause) {
      if (token === generation)
        failed(cause)
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function download(kind: 'xlsx' | 'public-zip' | 'private-zip') {
    const value = opened.value
    if (!value || busy.value || store.pending)
      return
    const token = generation
    busy.value = true
    error.value = ''
    const read = () => store.repository.workbookArchive({ origin: 'real', projectId: value.input.projectId }, { projectId: value.input.projectId, archiveId: value.id })
    try {
      await kit.exportFile({
        defaultName: `工资目录-版本${value.version}-${value.manifestHash}.${kind === 'xlsx' ? 'xlsx' : 'zip'}`,
        mimeType: kind === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/zip',
        data: async () => {
          const fresh = await read()
          if (token !== generation)
            throw new Error('工资目录查看范围已改变，下载已停止')
          assertPayrollWorkbookRead(fresh, value, kind === 'private-zip')
          const output = kind === 'xlsx' ? createPayrollSavedWorkbook(fresh) : await createPayrollSavedArchive(fresh, kind === 'private-zip', { archive: read, roster })
          assertPayrollWorkbookRead(await read(), value, kind === 'private-zip')
          if (token !== generation)
            throw new Error('工资目录查看范围已改变，下载已停止')
          if (!(output.data instanceof ArrayBuffer) && !(output.data instanceof Uint8Array))
            throw new Error('工资目录未生成可下载的完整正文')
          return output.data
        },
      })
    }
    catch (cause) {
      if (token === generation)
        failed(cause)
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  function change(patch: { mode?: PayrollWorkbookInput['mode'], subjectKey?: string, rosterArchiveId?: string }) {
    if (busy.value || store.pending)
      return
    if (patch.mode !== undefined)
      mode.value = patch.mode
    if (patch.subjectKey !== undefined)
      subjectKey.value = patch.subjectKey
    if (patch.rosterArchiveId !== undefined)
      rosterArchiveId.value = patch.rosterArchiveId
    else rosterArchiveId.value = ''
    previews.value = null
    opened.value = null
    void router.replace({ path: route.path, query: { origin: 'real', project: projectId.value, mode: mode.value, subject: subjectKey.value || undefined, roster: rosterArchiveId.value || undefined } })
  }
  function mayLeave() {
    if (busy.value || store.pending) {
      error.value = '请先完成当前操作或核对原保存结果'
      return false
    }
    return true
  }
  useTabCloseGuard(mayLeave)
  onBeforeRouteLeave(mayLeave)
  onBeforeRouteUpdate((to, from) => to.path === from.path && to.query.project === from.query.project ? true : mayLeave())
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (store.pending) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  const suspend = () => {
    generation++
    clearReads()
    busy.value = false
  }
  onDeactivated(suspend)
  onScopeDispose(suspend)
  onActivated(() => {
    store.restore()
    if (!list.value && !busy.value)
      void load()
  })
  watch(projectId, () => {
    mode.value = route.query.mode === 'project-month' ? 'project-month' : 'leader-cycle'
    subjectKey.value = typeof route.query.subject === 'string' ? route.query.subject : ''
    rosterArchiveId.value = typeof route.query.roster === 'string' ? route.query.roster : ''
    store.restore()
    void load()
  }, { immediate: true })
  return { projectId, mode, subjectKey, rosterArchiveId, list, subjects, selected, matchingRosters, current, opened, versions, busy, error, canSave, privateReadable, returnTo, rosterTo, pending: computed(() => store.pending), load, buildPreview, open, save, recover, download, change, changeProject: (id: string) => router.replace({ path: route.path, query: { origin: 'real', project: id || undefined } }), leave: () => router.push({ path: '/subcontract/payroll', query: { origin: 'real', project: projectId.value } }) }
}
