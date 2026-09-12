import type { ProjectMatchCandidate, SupplierMatchCandidate } from '~/lib/delivery/match'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch } from 'vue'
import { confirmedDeliveryProjectCandidates, normalizedDeliveryAlias } from '~/lib/delivery-record/reference-suggestions'

/** 正式浏览器只读取送货当前中央上下文，桌面旧适配保留显式本地边界。 */
export function useDeliveryReferences() {
  const archive = useDeliveryRecordStore()
  const central = archive.mode === 'central'
  const localProjects = central ? null : useProjectStore()
  const localAliases = central ? null : useProjectAliasStore()
  const localSuppliers = central ? null : useSupplierStore()
  const commands = central ? useSupplierCommandStore() : null
  const ready = shallowRef(false)
  const loading = shallowRef(false)
  const ownReadError = shallowRef('')
  const readError = computed(() => ownReadError.value || (central && ready.value ? archive.error : '') || '')
  let active = true
  let generation = 0
  const projects = computed(() => !ready.value ? [] : central ? archive.context?.projects ?? [] : localProjects?.list ?? [])
  const suppliers = computed<readonly SupplierMatchCandidate[]>(() => !ready.value ? [] : central ? archive.context?.suppliers ?? [] : localSuppliers?.list ?? [])
  const projectCandidates = computed<readonly ProjectMatchCandidate[]>(() => !ready.value
    ? []
    : central
      ? confirmedDeliveryProjectCandidates(archive.context?.projects ?? [], archive.list, archive.origin)
      : (localProjects?.list ?? []).map(project => ({ id: project.id, name: project.name, aliases: (localAliases?.list ?? []).filter(alias => alias.projectId === project.id).map(alias => alias.alias) })))
  const canWrite = computed(() => ready.value && (!central || archive.canWrite))

  async function reload() {
    const current = ++generation
    ready.value = false
    loading.value = true
    ownReadError.value = ''
    try {
      if (central)
        await archive.load()
      else
        await Promise.all([localProjects?.load(), localAliases?.load(), localSuppliers?.load()])
      if (active && current === generation)
        ready.value = true
    }
    catch (cause) {
      if (active && current === generation)
        ownReadError.value = cause instanceof Error ? cause.message : '项目与分供方资料读取失败'
    }
    finally {
      if (current === generation)
        loading.value = false
    }
  }

  async function rememberSupplierAlias(supplierId: string | null, sourceText: string) {
    const raw = sourceText.trim()
    const key = normalizedDeliveryAlias(raw)
    if (!supplierId || key.length < 2)
      return
    const current = generation
    const origin = archive.origin
    const check = () => {
      if (!active || generation !== current || archive.origin !== origin || !canWrite.value)
        throw new Error('来源或当前权限已变化，分供方别名未继续保存')
    }
    check()
    if (commands) {
      if (!suppliers.value.some(supplier => supplier.id === supplierId))
        throw new Error('当前分供方已不可选，请重新读取后处理别名')
      const session = commands.createSession()
      const { draft } = await commands.hydrate(session, supplierId)
      check()
      if (!draft)
        throw new Error('分供方资料读取失败，别名未保存')
      if ([draft.name, ...(draft.aliases ?? [])].filter((value): value is string => typeof value === 'string').map(normalizedDeliveryAlias).includes(key))
        return
      await commands.saveForm(session, { ...draft, aliases: [...draft.aliases ?? [], raw] }, 'draft', {})
      check()
      await reload()
      return
    }
    const supplier = localSuppliers?.byId(supplierId)
    if (supplier && ![supplier.name, ...supplier.aliases].map(normalizedDeliveryAlias).includes(key))
      await localSuppliers?.update(supplier.id, { ...supplier, aliases: [...supplier.aliases, raw] })
  }
  async function rememberProjectAlias(projectId: string, raw: string) {
    if (localAliases)
      await localAliases.remember(projectId, raw)
  }
  function suspend() {
    active = false
    generation++
    ready.value = false
  }
  onMounted(() => {
    void reload()
  })
  onActivated(() => {
    if (!active) {
      active = true
      void reload()
    }
  })
  watch(() => archive.origin, () => {
    ready.value = false
    generation++
    if (active)
      void reload()
  }, { flush: 'sync' })
  onDeactivated(suspend)
  onBeforeUnmount(suspend)
  return { projects, suppliers, projectCandidates, canWrite, loading, readError, reload, rememberSupplierAlias, rememberProjectAlias }
}
