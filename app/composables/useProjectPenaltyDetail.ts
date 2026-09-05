import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'
import { useSubcontractDocumentDetail } from './useSubcontractDocumentDetail'

export function useProjectPenaltyDetail(props: { documentId: string, origin: DataOriginDTO }) {
  const read = useSubcontractDocumentDetail(props, 'project_penalty')
  const amounts = computed(() => read.detail.value?.document.amounts.kind === 'project_penalty' ? read.detail.value.document.amounts : null)
  return { ...read, amounts }
}
