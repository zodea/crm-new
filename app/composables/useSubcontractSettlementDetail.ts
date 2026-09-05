import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'
import { useSubcontractDocumentDetail } from './useSubcontractDocumentDetail'

export function useSubcontractSettlementDetail(props: { documentId: string, origin: DataOriginDTO }) {
  const read = useSubcontractDocumentDetail(props, 'sub_settlement')
  const amounts = computed(() => read.detail.value?.document.amounts.kind === 'sub_settlement' ? read.detail.value.document.amounts : null)
  return { ...read, amounts }
}
