import type { WorkerPhotoPurpose, WorkerPhotoUpload, WorkerPrivateProfile } from '~/lib/worker-roster/contract'
import { useEventListener } from '@vueuse/core'
import { computed, onActivated, onDeactivated, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { CrewWorkerRepositoryProblem } from '~/lib/crew-worker/read-contract'
import { toErrorMessage } from '~/lib/util/error'
import { EMPTY_WORKER_PRIVATE } from '~/lib/worker-roster/contract'
import { workerRosterFileBytes } from '~/lib/worker-roster/export'
import { rosterCanonical } from '~/lib/worker-roster/validation'
import { useWorkerRosterStore } from '~/stores/worker-roster'

export function useWorkerPrivateProfile(workerId: () => string) {
  const store = useWorkerRosterStore()
  const kit = useKitUI()
  const router = useRouter()
  const current = shallowRef<WorkerPrivateProfile | null>(null)
  const values = ref({ ...EMPTY_WORKER_PRIVATE })
  const uploads = ref<Partial<Record<WorkerPhotoPurpose, WorkerPhotoUpload>>>({})
  const error = shallowRef('')
  const busy = shallowRef(false)
  const stale = shallowRef(false)
  let generation = 0
  const dirty = computed(() => !!current.value && (rosterCanonical(values.value) !== rosterCanonical(current.value.values) || Object.keys(uploads.value).length > 0))
  const writable = computed(() => !!current.value?.context.capabilities.includes('worker:write') && !busy.value && !store.pending && !stale.value)
  function failed(cause: unknown) {
    error.value = toErrorMessage(cause)
    if (cause instanceof CrewWorkerRepositoryProblem && cause.problem.code === 'forbidden')
      current.value = null
  }
  async function load(keepDraft = false) {
    const id = workerId()
    const token = ++generation
    busy.value = true
    error.value = ''
    try {
      const read = await store.repository.profile(id)
      if (token !== generation || id !== workerId())
        return
      current.value = read
      if (!keepDraft) {
        values.value = { ...read.values }
        uploads.value = {}
      }
      stale.value = false
    }
    catch (cause) {
      if (token === generation) {
        current.value = null
        error.value = toErrorMessage(cause)
      }
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function recover() {
    if (!current.value || busy.value)
      return
    busy.value = true
    error.value = ''
    let token = generation
    try {
      const resolved = await store.resolve(current.value.context)
      if (token !== generation)
        return
      const applied = resolved?.state === 'applied'
      const reading = load(!applied)
      token = generation
      await reading
      if (token !== generation)
        return
      if (!current.value || error.value)
        return
      store.acknowledge()
      kit.success(applied ? '已找回原提交，资料已重新读取' : '已确认原提交未保存，可以继续修改')
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
    if (!current.value || !writable.value || !dirty.value)
      return
    busy.value = true
    error.value = ''
    const read = current.value
    let token = generation
    try {
      await store.execute({ commandId: `worker-profile-${crypto.randomUUID()}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', sourceVersion: read.sourceVersion, action: 'save-profile', workerId: read.worker.id, values: { ...values.value }, uploads: { ...uploads.value } })
      if (token !== generation)
        return
      const reading = load()
      token = generation
      await reading
      if (token !== generation)
        return
      if (current.value && !error.value) {
        store.acknowledge()
        kit.success('工人资料已保存，新名册将使用这一版本')
      }
    }
    catch (cause) {
      if (token === generation) {
        failed(cause)
        stale.value = true
      }
    }
    finally {
      if (token === generation)
        busy.value = false
    }
  }
  async function choosePhoto(purpose: WorkerPhotoPurpose, file: File | undefined) {
    if (!file || !writable.value)
      return
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 1 || file.size > 20 * 1024 * 1024) {
      error.value = '请选择不超过 20 MB 的 PNG 或 JPEG 照片'
      return
    }
    const id = workerId()
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (id !== workerId() || !writable.value)
      return
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    uploads.value = { ...uploads.value, [purpose]: { fileName: file.name, mimeType: file.type, fileSize: file.size, payloadBase64: btoa(binary) } }
  }
  async function download(assetId: string) {
    const id = workerId()
    const token = generation
    const asset = current.value?.assets.find(row => row.id === assetId)
    if (!asset)
      return
    await kit.exportFile({ defaultName: asset.fileName, mimeType: asset.mimeType, data: async () => {
      try {
        const read = await store.repository.file({ workerId: id, assetId })
        const bytes = await workerRosterFileBytes(read)
        if (token !== generation || id !== workerId())
          throw new Error('工人范围已变化，请重新下载')
        return bytes
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
  async function mayLeave() {
    if (busy.value || store.pending) {
      error.value = '请先核对当前提交结果'
      return false
    }
    return !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃资料修改', message: '资料和新照片尚未保存，确认放弃？', confirmLabel: '放弃修改' })
  }
  useTabCloseGuard(mayLeave)
  onBeforeRouteLeave(mayLeave)
  onBeforeRouteUpdate(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || store.pending) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  onDeactivated(() => {
    generation++
    current.value = null
    uploads.value = {}
    values.value = { ...EMPTY_WORKER_PRIVATE }
    busy.value = false
  })
  onActivated(() => {
    store.restore()
    if (!current.value && !busy.value)
      void load()
  })
  watch(workerId, () => {
    current.value = null
    store.restore()
    void load()
  }, { immediate: true })
  return { current, values, uploads, error, busy, dirty, writable, stale, pending: computed(() => store.pending), load, recover, save, choosePhoto, download, leave: () => router.push(`/base/worker/${encodeURIComponent(workerId())}?origin=real`) }
}
