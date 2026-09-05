import type { DataOriginDTO } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import { ownerDocumentFormPath } from '~/lib/owner-document/page'
import { loadOwnerDocumentReturnOrigin, resolveOwnerDocumentReturnContext } from '~/lib/owner-document/return-context'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useOwnerCommercialDocumentReadStore } from '~/stores/owner-commercial-document-read'

export function useSubcontractSettlementDetail(props: { documentId: string, origin: DataOriginDTO }) {
  const route = useRoute()
  const store = useOwnerCommercialDocumentReadStore()
  const visibilityStore = useDataVisibilityStore()
  const detail = computed(() => {
    const current = store.detailState
    if (current.kind === 'ready')
      return current.data
    if ((current.kind === 'loading' || current.kind === 'error') && current.previous)
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
      ? '正在读取分包结算'
      : shellState.value === 'forbidden'
        ? '无权查看分包结算'
        : shellState.value === 'not-found'
          ? '分包结算不存在'
          : '分包结算读取失败')
  const returnContext = computed(() => resolveOwnerDocumentReturnContext({
    kind: 'sub_settlement',
    returnTo: route.query.returnTo,
    contextId: route.query.returnContext,
    origin: props.origin,
    now: Date.now(),
    load: id => import.meta.client ? loadOwnerDocumentReturnOrigin(id) : null,
  }))
  const backLabel = computed(() => returnContext.value.to.split('?')[0] === '/subcontract/settlement'
    ? '返回分包结算列表'
    : '返回来源详情')
  const canEdit = computed(() => detail.value?.dataOrigin === 'real'
    && detail.value.capabilities.includes('subcontract-document:write')
    && ownerDocumentStatusIsEditable(detail.value.document.status))
  const amounts = computed(() => detail.value?.document.amounts.kind === 'sub_settlement'
    ? detail.value.document.amounts
    : null)

  function load() {
    return store.loadDetail({
      kind: 'sub_settlement',
      id: props.documentId,
      origin: props.origin,
      includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
      variant: null,
    })
  }

  function edit() {
    void navigateTo({
      path: ownerDocumentFormPath('sub_settlement', props.documentId),
      query: { origin: 'real', returnTo: route.fullPath },
    })
  }

  watch(() => [props.documentId, props.origin], () => void load(), { immediate: true })
  onActivated(() => void load())
  useTabTitle(() => detail.value?.document.name ?? '分包结算详情')

  return { route, store, detail, loading, problem, shellState, stateTitle, returnContext, backLabel, canEdit, amounts, load, edit }
}
