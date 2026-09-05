import type { DataOriginDTO } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import { OWNER_DOCUMENT_META, ownerDocumentFormPath } from '~/lib/owner-document/page'
import { loadOwnerDocumentReturnOrigin, resolveOwnerDocumentReturnContext } from '~/lib/owner-document/return-context'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useOwnerCommercialDocumentReadStore } from '~/stores/owner-commercial-document-read'

export function useSubcontractDocumentDetail(props: { documentId: string, origin: DataOriginDTO }, kind: 'project_penalty' | 'sub_settlement') {
  const meta = OWNER_DOCUMENT_META[kind]
  const route = useRoute()
  const store = useOwnerCommercialDocumentReadStore()
  const visibilityStore = useDataVisibilityStore()
  const detail = computed(() => {
    const current = store.detailState
    if (current.kind === 'ready' && current.data.document.kind === kind && current.data.document.id === props.documentId && current.data.dataOrigin === props.origin)
      return current.data
    if ((current.kind === 'loading' || current.kind === 'error') && current.previous?.document.kind === kind && current.previous.document.id === props.documentId && current.previous.dataOrigin === props.origin)
      return current.previous
    return null
  })
  const loading = computed(() => store.detailState.kind === 'loading')
  const problem = computed(() => 'problem' in store.detailState ? store.detailState.problem : null)
  const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
    if (detail.value)
      return 'ready'
    if (store.detailState.kind === 'idle' || store.detailState.kind === 'loading')
      return 'loading'
    if (store.detailState.kind === 'forbidden')
      return 'forbidden'
    if (store.detailState.kind === 'not-found')
      return 'not-found'
    return 'error'
  })
  const stateTitle = computed(() => store.detailState.kind === 'mismatch'
    ? '单据来源或关系不匹配'
    : shellState.value === 'loading'
      ? `正在读取${meta.label}`
      : shellState.value === 'forbidden'
        ? `无权查看${meta.label}`
        : shellState.value === 'not-found'
          ? `${meta.label}不存在`
          : `${meta.label}读取失败`)
  const returnContext = computed(() => resolveOwnerDocumentReturnContext({
    kind,
    returnTo: route.query.returnTo,
    contextId: route.query.returnContext,
    origin: props.origin,
    now: Date.now(),
    load: id => import.meta.client ? loadOwnerDocumentReturnOrigin(id) : null,
  }))
  const backLabel = computed(() => returnContext.value.to.split('?')[0] === meta.listPath
    ? `返回${meta.label}列表`
    : '返回来源详情')
  const canEdit = computed(() => detail.value?.dataOrigin === 'real'
    && detail.value.capabilities.includes('subcontract-document:write')
    && ownerDocumentStatusIsEditable(detail.value.document.status))

  function load() {
    return store.loadDetail({
      kind,
      id: props.documentId,
      origin: props.origin,
      includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
      variant: null,
    })
  }

  function edit() {
    void navigateTo({
      path: ownerDocumentFormPath(kind, props.documentId),
      query: { origin: 'real', returnTo: route.fullPath },
    })
  }

  watch(() => [props.documentId, props.origin], () => void load(), { immediate: true })
  onActivated(() => void load())
  useTabTitle(() => detail.value?.document.name ?? `${meta.label}详情`)

  return { route, store, detail, loading, problem, shellState, stateTitle, returnContext, backLabel, canEdit, load, edit }
}
