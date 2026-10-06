import type { EntityRefDTO } from '~/types/read-model'

export function materialContractReferenceLabel(reference: EntityRefDTO): string {
  if (reference.state === 'resolved')
    return reference.label
  if (reference.state === 'forbidden')
    return '无权查看'
  if (reference.state === 'unavailable')
    return '来源暂不可用'
  return reference.reason === 'not-configured' ? '目标已不存在' : '未记录'
}
