import type { BoqBuildingContext } from '~/lib/boq/central-building-contract'
import type { ScheduleBindingRead } from '~/lib/schedule/central-binding-contract'
import { useSessionStorage } from '@vueuse/core'
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { buildScheduleBindingFloorLocation, parseScheduleBindingReturnTo } from '~/lib/schedule/binding-navigation'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

interface EvidenceDraft { lineId: string, buildingId: string, reason: string }
export function useBoqBuildingEvidence() {
  const route = useRoute()
  const router = useRouter()
  const store = useBoqBuildingStore()
  const scheduleStore = useScheduleStore()
  const { confirm, success } = useKitUI()
  const read = shallowRef<BoqBuildingContext | null>(null)
  const binding = shallowRef<ScheduleBindingRead | null>(null)
  const lineId = shallowRef('')
  const buildingId = shallowRef('')
  const reason = shallowRef('')
  const loading = shallowRef(false)
  const confirming = shallowRef(false)
  const error = shallowRef('')
  const active = shallowRef(true)
  const drafts = useSessionStorage<Record<string, EvidenceDraft>>('ruihang:boq-building-drafts-v1', {})
  const formKey = deriveKey(route.fullPath)
  let sequence = 0
  let loadedTarget = ''
  let started = false
  let allowLeave = false
  const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
  const contractId = computed(() => typeof route.query.contract === 'string' ? route.query.contract : '')
  const origin = computed(() => route.query.origin === 'real' ? 'real' : null)
  const target = () => JSON.stringify([projectId.value, contractId.value, origin.value, route.query.returnTo, route.query.line, route.query.mode])
  const returnTo = computed(() => origin.value ? parseScheduleBindingReturnTo(route.query.returnTo, projectId.value, contractId.value, origin.value) : null)
  const selectedLine = computed(() => read.value?.lines.find(line => line.id === lineId.value) ?? null)
  const busy = computed(() => loading.value || confirming.value || store.saving)
  const readonlyMode = computed(() => route.query.mode === 'read')
  const canEdit = computed(() => !readonlyMode.value && !busy.value && !store.pendingCommand && read.value?.origin === 'real' && read.value.capabilities.includes('owner-document:write') && selectedLine.value?.sourceKind === 'confirmed-import' && !selectedLine.value.readOnlyReason)
  const floorLinks = computed(() => {
    const value = binding.value
    if (value?.state !== 'bound' || value.group.contractId !== contractId.value || !selectedLine.value)
      return []
    const ids = [...new Set((value.binding?.preview?.items ?? []).filter(item => item.contractLineIds.includes(selectedLine.value!.id)).flatMap(item => item.floorPlanIds))]
    const query = returnTo.value ? Object.fromEntries(new URL(returnTo.value, 'https://ruihang.invalid').searchParams) : {}
    return ids.map((id, index) => ({ id, label: `查看原楼层计划 ${index + 1}`, to: buildScheduleBindingFloorLocation(projectId.value, value.group.id, contractId.value, id, query, selectedLine.value!.id) }))
  })
  const dirty = computed(() => !readonlyMode.value && Boolean(buildingId.value || reason.value.trim()))
  const lineOptions = computed(() => (read.value?.lines ?? []).map(line => ({ key: line.id, label: `${line.itemName} · ${line.unit || '单位未提供'} · ${line.building || '楼栋未提供'} · 原量 ${line.qty ?? '未提供'} · ${line.sourceKind === 'confirmed-import' ? '已确认导入' : line.sourceKind === 'change-addition' ? '签证新增，只读' : '来源待核，只读'}` })))
  const buildingOptions = computed(() => (read.value?.buildings ?? []).map(building => ({ key: building.id, label: `${building.name}${building.code ? ` · ${building.code}` : ''}` })))
  const draft = () => ({ lineId: lineId.value, buildingId: buildingId.value, reason: reason.value })
  const keyFor = (value: BoqBuildingContext) => JSON.stringify([value.workspaceId, value.actorId, value.origin, value.projectId, value.contractId])
  function remember() {
    if (read.value && !readonlyMode.value)
      drafts.value = { ...drafts.value, [keyFor(read.value)]: draft() }
  }
  function clearDraft(value: BoqBuildingContext) {
    const next = { ...drafts.value }
    delete next[keyFor(value)]
    drafts.value = next
  }
  function sameTarget(value: string, request: number) {
    return active.value && value === target() && request === sequence
  }

  async function load(restore = false, retainSelection = false) {
    const request = ++sequence
    const current = target()
    loading.value = true
    error.value = ''
    if (!origin.value || !isStableRouteIdentity(projectId.value) || !isStableRouteIdentity(contractId.value) || !returnTo.value
      || (route.query.line != null && !isStableRouteIdentity(route.query.line)) || (route.query.mode != null && route.query.mode !== 'read')) {
      read.value = null
      error.value = '项目、合同或返回分组不匹配，请从原绑定页重新打开'
      loading.value = false
      return
    }
    try {
      const value = await store.read({ projectId: projectId.value, contractId: contractId.value, origin: origin.value })
      if (!sameTarget(current, request))
        return
      read.value = value
      if (restore) {
        const saved = drafts.value[keyFor(value)]
        lineId.value = retainSelection && loadedTarget === current && saved?.lineId
          ? saved.lineId
          : typeof route.query.line === 'string' ? route.query.line : saved?.lineId ?? ''
        const matchingDraft = !readonlyMode.value && saved?.lineId === lineId.value ? saved : null
        buildingId.value = matchingDraft?.buildingId ?? ''
        reason.value = matchingDraft?.reason ?? ''
      }
      loadedTarget = current
      if (lineId.value && !value.lines.some(line => line.id === lineId.value)) {
        lineId.value = ''
        error.value = '原清单行已失效，请重新选择；未更正任何来源'
      }
      if (buildingId.value && !value.buildings.some(building => building.id === buildingId.value)) {
        buildingId.value = ''
        error.value = '原楼栋已失效，请重新核对实际楼栋'
      }
      const groupId = decodeURIComponent(new URL(returnTo.value!, 'https://ruihang.invalid').pathname.split('/').at(-1)!)
      try {
        const source = await scheduleStore.readBinding(value.projectId, groupId, '', value.origin)
        if (sameTarget(current, request))
          binding.value = source
      }
      catch {
        if (sameTarget(current, request))
          binding.value = null
      }
    }
    catch (cause) {
      if (sameTarget(current, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (sameTarget(current, request))
        loading.value = false
    }
  }
  async function mayLeave() {
    if (store.pendingCommand || confirming.value || store.saving)
      return false
    if (allowLeave || !dirty.value)
      return true
    const current = target()
    const previous = JSON.stringify(draft())
    const approved = await confirm({ variant: 'simple', title: '放弃本次楼栋更正？', message: '楼栋选择和更正理由尚未保存，合同清单保持不变。', confirmLabel: '放弃更正' })
    if (!approved || current !== target() || previous !== JSON.stringify(draft()))
      return false
    if (read.value)
      clearDraft(read.value)
    return true
  }
  useTabCloseGuard(mayLeave)
  async function selectLine(value: string | undefined) {
    const next = typeof value === 'string' ? value : ''
    if (next === lineId.value || busy.value || store.pendingCommand || !read.value?.lines.some(line => line.id === next))
      return
    const current = target()
    if (!await mayLeave() || !active.value || current !== target())
      return
    lineId.value = next
    buildingId.value = ''
    reason.value = ''
  }
  async function leave() {
    const current = target()
    if (!await mayLeave() || !active.value || current !== target() || !returnTo.value)
      return
    allowLeave = true
    useTabsStore().close(formKey)
    await router.push(returnTo.value)
  }
  async function finish(value: BoqBuildingContext) {
    clearDraft(value)
    allowLeave = true
    success('合同楼栋证据已更正，请重新核对绑定差异')
    useTabsStore().close(formKey)
    if (returnTo.value)
      await router.push(returnTo.value)
  }
  async function save() {
    const value = read.value
    if (!value || !canEdit.value || !buildingId.value || !reason.value.trim() || error.value)
      return
    const current = target()
    const request = sequence
    const body = draft()
    confirming.value = true
    try {
      const approved = await confirm({ variant: 'simple', title: '更正合同清单的楼栋证据？', message: '仅更正所选清单行的显式楼栋，数量、单价、签证审批和历史快照保持不变。返回绑定页后需重新预览。', confirmLabel: '保存楼栋证据' })
      if (!approved || !sameTarget(current, request) || read.value !== value || JSON.stringify(body) !== JSON.stringify(draft()))
        return
      await store.save(value, body.lineId, body.buildingId, body.reason.trim())
      if (sameTarget(current, request))
        await finish(value)
    }
    catch (cause) {
      if (sameTarget(current, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (sameTarget(current, request))
        confirming.value = false
    }
  }
  async function recover() {
    const value = read.value
    const command = store.pendingCommand
    if (!value || busy.value || !command)
      return
    const current = target()
    const request = sequence
    try {
      await store.recover()
      if (sameTarget(current, request)) {
        const matching = 'family' in command ? command.scopeId === `${value.projectId}:${value.contractId}` && command.targetId === lineId.value && command.workspaceId === value.workspaceId && command.actorId === value.actorId : command.projectId === value.projectId && command.contractId === value.contractId && command.origin === value.origin && command.workspaceId === value.workspaceId && command.actorId === value.actorId && command.lineId === lineId.value
        if (matching)
          await finish(value)
        else
          await load()
      }
    }
    catch (cause) {
      if (sameTarget(current, request))
        error.value = toErrorMessage(cause)
    }
  }
  watch([lineId, buildingId, reason], remember)
  watch(() => [projectId.value, contractId.value, origin.value, route.query.returnTo, route.query.line, route.query.mode], () => {
    if (!active.value)
      return
    started = true
    read.value = null
    binding.value = null
    lineId.value = ''
    buildingId.value = ''
    reason.value = ''
    confirming.value = false
    allowLeave = false
    void load(true)
  }, { immediate: true })
  onDeactivated(() => {
    if (!allowLeave)
      remember()
    active.value = false
    confirming.value = false
    sequence += 1
    store.cancelRead()
  })
  onActivated(() => {
    if (active.value && started)
      return
    active.value = true
    confirming.value = false
    allowLeave = false
    void load(true, true)
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
    store.cancelRead()
  })
  return { read, selectedLine, lineId, buildingId, reason, loading, error, canEdit, readonlyMode, floorLinks, busy, dirty, store, lineOptions, buildingOptions, selectLine, save, leave, mayLeave, recover, recheck: () => load() }
}
