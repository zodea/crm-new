import type { ProjectContractFormDraft } from '../../app/lib/contract/forms'
import { constructionContractProblem, ConstructionContractRepositoryProblem } from '../../app/lib/construction-contract/repository'
import { customerReadTestInstance } from './customer-read-test-instance'
import { projectReadTestInstance } from './project-read-test-instance'

/** 表单候选和保存校验读取同一中央身份集合；客户 facts 不反调合同聚合。 */
export function constructionContractReferences(sessionId?: string | null) {
  const projects = projectReadTestInstance.facts(sessionId).rows.filter(row => row.dataOrigin === 'real')
  const customers = customerReadTestInstance.facts(sessionId).rows.filter(row => row.dataOrigin === 'real')
  return {
    projects: projects.map(row => ({ id: row.id, label: row.name, customerId: row.customerId })),
    customers: customers.map(row => ({ id: row.id, label: row.name })),
  }
}

export function assertConstructionContractReferences(draft: ProjectContractFormDraft, sessionId?: string | null) {
  const refs = constructionContractReferences(sessionId)
  for (const [field, rows] of [['projectId', refs.projects], ['customerId', refs.customers]] as const) {
    if (draft[field] && rows.filter(row => row.id === draft[field]).length !== 1) {
      throw new ConstructionContractRepositoryProblem({
        ...constructionContractProblem('validation-failed', '合同关联身份不存在或不在正式可读范围'),
        fieldErrors: { [field]: ['请重新选择有效的正式记录'] },
      })
    }
  }
  const project = refs.projects.find(row => row.id === draft.projectId)
  if (project && draft.customerId && project.customerId !== draft.customerId) {
    throw new ConstructionContractRepositoryProblem({
      ...constructionContractProblem('validation-failed', '项目与甲方客户关系不匹配'),
      fieldErrors: { customerId: ['必须选择项目当前客户'] },
    })
  }
}
