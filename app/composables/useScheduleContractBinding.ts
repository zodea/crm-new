import type { LookupOption } from '~/lib/kit/lookup'
import type { ScheduleBindingRead } from '~/lib/schedule/central-binding-contract'
import type { DataOriginDTO } from '~/types/read-model'
import { useSessionStorage } from '@vueuse/core'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { buildBoqBuildingEvidenceLocation } from '~/lib/schedule/binding-navigation'
import { scheduleReturnContextQuery } from '~/lib/schedule/navigation'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

export function useScheduleContractBinding(props: { projectId: string, groupId: string, origin: DataOriginDTO | null }) {
  const route = useRoute()
  const router = useRouter()
  const store = useScheduleStore()
  const { confirm, success } = useKitUI()
  const read = shallowRef<ScheduleBindingRead | null>(null)
  const selectedContractId = shallowRef('')
  const loading = shallowRef(false)
  const confirming = shallowRef(false)
  const error = shallowRef('')
  const active = shallowRef(true)
  const drafts = useSessionStorage<Record<string, string>>('ruihang:schedule-binding-drafts-v1', {})
  const formKey = deriveKey(route.fullPath)
  let sequence = 0
  let started = false
  let allowLeave = false
  const targetKey = () => JSON.stringify([props.projectId, props.groupId, props.origin])
  const keyFor = (value: ScheduleBindingRead) => JSON.stringify([value.workspaceId, value.actorId, value.origin, value.group.projectId, value.group.id])
  const busy = computed(() => loading.value || confirming.value || store.saving)
  const canChoose = computed(() => read.value?.state === 'unbound' && read.value.origin === 'real' && read.value.capabilities.includes('schedule:write') && !busy.value && !store.pendingCommand)
  const dirty = computed(() => read.value?.state === 'unbound' && Boolean(selectedContractId.value))
  const preview = computed(() => read.value?.preview ?? null)
  const returnLocation = computed(() => ({ path: '/schedule', query: { ...scheduleReturnContextQuery(route.query), project: props.projectId, group: props.groupId, ...(props.origin ? { origin: props.origin } : {}) } }))

  function remember(value = read.value) {
    if (value?.state === 'unbound' && selectedContractId.value)
      drafts.value = { ...drafts.value, [keyFor(value)]: selectedContractId.value }
  }
  function clearDraft(value: ScheduleBindingRead) {
    const next = { ...drafts.value }
    delete next[keyFor(value)]
    drafts.value = next
  }
  function sameTarget(target: string, request: number) {
    return active.value && target === targetKey() && request === sequence
  }

  async function load(contractId?: string) {
    const request = ++sequence
    const target = targetKey()
    loading.value = true
    error.value = ''
    if (!props.origin || !isStableRouteIdentity(props.projectId) || !isStableRouteIdentity(props.groupId)) {
      read.value = null
      error.value = '项目、分组或来源参数无效，请从施工进度重新打开'
      loading.value = false
      return
    }
    try {
      let value = await store.readBinding(props.projectId, props.groupId, contractId ?? '', props.origin)
      if (!sameTarget(target, request))
        return
      if (value.group.projectId !== props.projectId || value.group.id !== props.groupId || value.origin !== props.origin)
        throw new Error('返回的绑定资料与当前分组不一致')
      if (contractId === undefined && value.state === 'unbound') {
        const requested = typeof route.query.contract === 'string' ? route.query.contract : drafts.value[keyFor(value)] ?? ''
        if (requested && value.contracts.some(contract => contract.id === requested)) {
          selectedContractId.value = requested
          value = await store.readBinding(props.projectId, props.groupId, requested, props.origin)
          if (!sameTarget(target, request))
            return
        }
        else if (requested) {
          selectedContractId.value = ''
          error.value = '原选择的施工合同已失效，请重新选择当前项目合同'
        }
      }
      read.value = value
      selectedContractId.value = value.state === 'bound' ? value.group.contractId ?? '' : value.preview?.contractId ?? selectedContractId.value
      remember(value)
    }
    catch (cause) {
      if (sameTarget(target, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (sameTarget(target, request))
        loading.value = false
    }
  }

  async function selectContract(id: string | null) {
    if (!canChoose.value)
      return
    const contractId = id ?? ''
    if (contractId && !read.value?.contracts.some(contract => contract.id === contractId))
      return
    selectedContractId.value = contractId
    remember()
    // 清旧预览后发起读取，失败时不能继续确认旧合同。
    if (read.value)
      read.value = { ...read.value, preview: null }
    await load(contractId)
  }

  async function fetchContracts(keyword: string): Promise<LookupOption[]> {
    const needle = keyword.trim().toLocaleLowerCase('zh-CN')
    return (read.value?.contracts ?? []).filter(contract => !needle || `${contract.name} ${contract.no}`.toLocaleLowerCase('zh-CN').includes(needle)).map(contract => ({ id: contract.id, label: contract.name, hint: `${contract.no || '未编号'} · ${contract.lineCount} 条清单` }))
  }

  async function mayLeave() {
    if (store.pendingCommand || confirming.value || store.saving)
      return false
    if (allowLeave || !dirty.value)
      return true
    const target = targetKey()
    const request = sequence
    const selected = selectedContractId.value
    const approved = await confirm({ variant: 'simple', title: '离开合同绑定？', message: '尚未执行绑定，当前合同选择会保留。返回后将重新核对资料。', confirmLabel: '保留选择并返回' })
    return approved && target === targetKey() && request === sequence && selected === selectedContractId.value
  }
  useTabCloseGuard(mayLeave)

  async function cancel() {
    const target = targetKey()
    if (!await mayLeave() || !active.value || target !== targetKey())
      return
    remember()
    allowLeave = true
    useTabsStore().close(formKey)
    await router.push(returnLocation.value)
  }

  async function finish(value: ScheduleBindingRead) {
    clearDraft(value)
    allowLeave = true
    success('施工合同已绑定，原计划与暂估来源已保留')
    useTabsStore().close(formKey)
    await router.push(returnLocation.value)
  }

  async function bind(trigger?: HTMLElement) {
    const value = read.value
    if (!value?.preview?.canBind || !canChoose.value || error.value || value.preview.contractId !== selectedContractId.value)
      return
    const target = targetKey()
    const request = sequence
    confirming.value = true
    try {
      const approved = await confirm({ variant: 'simple', title: `绑定施工合同「${value.preview.contractName}」？`, message: '确认后仅更新本分组的合同依据，保留原任务、依赖、人工计划、基线、冻结暂估量及完成事实；合同额外楼栋不会纳入。', confirmLabel: '确认绑定' })
      if (!approved || !sameTarget(target, request) || read.value !== value || store.pendingCommand)
        return
      await store.confirmBinding(value)
      if (sameTarget(target, request))
        await finish(value)
    }
    catch (cause) {
      if (sameTarget(target, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (sameTarget(target, request)) {
        confirming.value = false
        await nextTick()
        if (sameTarget(target, request) && !error.value && !store.pendingCommand && trigger?.isConnected)
          trigger.focus()
      }
    }
  }

  async function recover() {
    const value = read.value
    const command = store.pendingCommand
    if (!value || !command || busy.value)
      return
    const target = targetKey()
    const request = sequence
    try {
      await store.recoverPending()
      if (!sameTarget(target, request))
        return
      if (command.action.kind === 'bind-contract' && command.action.groupId === value.group.id && command.projectId === value.group.projectId && command.origin === value.origin && command.workspaceId === value.workspaceId && command.actorId === value.actorId)
        await finish(value)
      else
        await load(selectedContractId.value)
    }
    catch (cause) {
      if (sameTarget(target, request))
        error.value = toErrorMessage(cause)
    }
  }

  async function repair(lineId = '') {
    const value = read.value
    if (!value || !(value.preview || value.binding?.preview) || props.origin !== 'real' || busy.value || store.pendingCommand)
      return
    remember(value)
    await router.push(buildBoqBuildingEvidenceLocation(props.projectId, props.groupId, selectedContractId.value, route.query, lineId, value.state === 'bound'))
  }

  watch(() => [props.projectId, props.groupId, props.origin, route.query.contract], () => {
    if (!active.value)
      return
    started = true
    read.value = null
    selectedContractId.value = ''
    confirming.value = false
    allowLeave = false
    void load()
  }, { immediate: true })
  onDeactivated(() => {
    if (!allowLeave)
      remember()
    active.value = false
    confirming.value = false
    sequence += 1
    store.cancelBindingRead()
  })
  onActivated(() => {
    if (active.value && started)
      return
    active.value = true
    confirming.value = false
    allowLeave = false
    void load()
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
    store.cancelBindingRead()
  })
  return { read, preview, selectedContractId, loading, confirming, error, busy, canChoose, store, dirty, fetchContracts, selectContract, bind, cancel, mayLeave, recover, repair, recheck: () => load(selectedContractId.value), returnLocation }
}
