import type { EntityRefDTO } from '~/types/read-model'

export function materialContractReferenceLabel(reference: EntityRefDTO): string {
  if (reference.state === 'resolved')
    return reference.label
  if (reference.state === 'forbidden')
    return '无权查看'
  return reference.reason === 'not-configured' ? '目标已不存在' : '未记录'
}
