import type { PayrollListRead } from '~/lib/payroll/central-contract'
import type { WorkerRosterArchive, WorkerRosterArchiveSummary, WorkerRosterPreview } from '~/lib/worker-roster/contract'
import { useEventListener } from '@vueuse/core'
import { computed, onActivated, onDeactivated, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { CrewWorkerRepositoryProblem } from '~/lib/crew-worker/read-contract'
import { toErrorMessage } from '~/lib/util/error'
import { WORKER_PRIVATE_READ } from '~/lib/worker-roster/contract'
import { createWorkerRosterArchiveZip, workerRosterFilename } from '~/lib/worker-roster/export'
import { useWorkerRosterStore } from '~/stores/worker-roster'

export function useWorkerRosterArchive() {
  const route = useRoute()
  const router = useRouter()
  const kit = useKitUI()
  const store = useWorkerRosterStore()
  const payroll = useNuxtApp().$repositories.payroll
  const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
  const list = shallowRef<PayrollListRead | null>(null)
  const selectedIds = ref<string[]>([])
  const registeredOn = ref(new Date().toLocaleDateString('en-CA'))
  const preview = shallowRef<WorkerRosterPreview | null>(null)
  const opened = shallowRef<WorkerRosterArchive | null>(null)
  const versions = shallowRef<WorkerRosterArchiveSummary[]>([])
  const busy = shallowRef(false)
  const error = shallowRef('')
  let generation = 0
  const rows = computed(() => list.value?.rows.filter(row => row.projectId === projectId.value && row.recordKind === 'central' && row.status === 'released' && !row.hidden && !row.deletedAt && ['A', 'C1', 'C2'].includes(row.formatFamily)) ?? [])
  const writable = computed(() => !!preview.value?.context.capabilities.includes('payroll:write') && !busy.value && !store.pending)
  function failed(cause: unknown) {
    error.value = toErrorMessage(cause)
    if (cause instanceof CrewWorkerRepositoryProblem && cause.problem.code === 'forbidden') {
      list.value = null
      preview.value = null
      opened.value = null
      versions.value = []
    }
  }
  async function load() {
    const token = ++generation
    busy.value = true
    error.value = ''
    try {
      const value = await payroll.list({ origin: 'real', ...(projectId.value ? { projectId: projectId.value } : {}) })
      if (!value.context.capabilities.includes(WORKER_PRIVATE_READ))
        throw new Error('当前身份没有工人私密资料读取权限；工资权限不自动包含此权限。')
      const saved = projectId.value ? await store.repository.archives(projectId.value) : []
      if (token !== generation)
        return
      list.value = value
      versions.value = saved
    }
    catch (cause) {
      if (token === generation) {
        list.value = null
        preview.value = null
        opened.value = null
        versions.value = []
        error.value = toErrorMessage(cause)
      }
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function buildPreview() {
    if (busy.value || store.pending)
      return
    busy.value = true
    error.value = ''
    const token = generation
    opened.value = null
    try {
      const value = await store.repository.preview({ projectId: projectId.value, statementIds: [...selectedIds.value], registeredOn: registeredOn.value })
      if (token === generation) {
        preview.value = value
        opened.value = null
      }
    }
    catch (cause) {
      if (token === generation) {
        preview.value = null
        failed(cause)
      }
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function open(id: string) {
    if (busy.value || store.pending)
      return
    busy.value = true
    error.value = ''
    const token = generation
    try {
      const value = await store.repository.archive(projectId.value, id)
      if (token === generation) {
        opened.value = value
        preview.value = null
      }
    }
    catch (cause) {
      if (token === generation) {
        opened.value = null
        failed(cause)
      }
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function recover() {
    if (!list.value || busy.value)
      return
    busy.value = true
    error.value = ''
    let token = generation
    try {
      const resolved = await store.resolve({ ...list.value.context, capabilities: [...list.value.context.capabilities], origin: 'real' })
      if (token !== generation)
        return
      if (resolved?.state === 'applied' && resolved.result.archiveId && store.pending?.projectId === projectId.value) {
        const read = await store.repository.archive(projectId.value, resolved.result.archiveId)
        if (token !== generation)
          return
        opened.value = read
      }
      const reading = load()
      token = generation
      await reading
      if (token !== generation || error.value)
        return
      store.acknowledge()
      preview.value = null
      kit.success(resolved?.state === 'applied' ? '已找回原提交，请查看固定版本' : '已确认原提交未保存，请重新预览')
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
    const value = preview.value
    if (!value || !writable.value)
      return
    busy.value = true
    error.value = ''
    let token = generation
    try {
      const result = await store.execute({ commandId: `worker-roster-${crypto.randomUUID()}`, workspaceId: value.context.workspaceId, actorId: value.context.actorId, origin: 'real', sourceVersion: value.sourceVersion, action: 'archive', scope: value.scope })
      if (token !== generation)
        return
      const read = await store.repository.archive(value.scope.projectId, result.archiveId!)
      if (token !== generation)
        return
      opened.value = read
      const reading = load()
      token = generation
      await reading
      if (token !== generation)
        return
      if (!error.value) {
        store.acknowledge()
        preview.value = null
        kit.success('名册已形成不可变归档版本')
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
  async function download() {
    const value = opened.value
    if (!value || busy.value || store.pending)
      return
    const token = generation
    await kit.exportFile({ defaultName: `${workerRosterFilename(value)}.zip`, mimeType: 'application/zip', data: async () => {
      try {
        const fresh = await store.repository.archive(value.scope.projectId, value.id)
        const data = await createWorkerRosterArchiveZip(fresh, store.repository.file)
        await store.repository.archive(value.scope.projectId, value.id)
        if (token !== generation)
          throw new Error('名册查看范围已变化，导出已停止')
        return data
      }
      catch (cause) {
        if (token === generation)
          failed(cause)
        throw cause
      }
    } }).catch((cause) => {
      if (token === generation)
        failed(cause)
    })
  }
  function toggle(id: string, checked: boolean) {
    if (busy.value || store.pending)
      return
    selectedIds.value = checked ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter(value => value !== id)
  }
  async function mayLeave() {
    if (busy.value || store.pending) {
      error.value = '请先核对当前提交结果'
      return false
    }
    return !preview.value || await kit.confirm({ variant: 'simple', title: '离开名册预览', message: '当前预览尚未形成归档，确认离开？', confirmLabel: '离开' })
  }
  useTabCloseGuard(mayLeave)
  onBeforeRouteLeave(mayLeave)
  onBeforeRouteUpdate(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (store.pending) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  onDeactivated(() => {
    generation++
    list.value = null
    preview.value = null
    opened.value = null
    versions.value = []
    busy.value = false
  })
  onActivated(() => {
    store.restore()
    if (!list.value && !busy.value)
      void load()
  })
  watch([selectedIds, registeredOn], () => {
    preview.value = null
  })
  watch(projectId, () => {
    list.value = null
    preview.value = null
    opened.value = null
    selectedIds.value = []
    versions.value = []
    store.restore()
    void load()
  }, { immediate: true })
  return { projectId, list, rows, selectedIds, registeredOn, preview, opened, versions, busy, error, writable, pending: computed(() => store.pending), load, buildPreview, open, recover, save, download, toggle, changeProject: (id: string) => router.replace({ path: '/subcontract/payroll/roster', query: { origin: 'real', project: id } }), leave: () => router.push({ path: '/subcontract/payroll', query: { origin: 'real', project: projectId.value } }) }
}
